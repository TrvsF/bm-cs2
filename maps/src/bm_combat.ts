import { Instance, Console, CSDamageTypes, CSWeaponType } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSWeaponBase, TraceResult } from "cs_script/point_script";
import { bDebug, IsFriendlyFire, LogPrefix, UpVector, ZeroVector, VectorMath, RotationMath, IsPlayerPawn, IsModelEntity, GetChestPosition, SpawnTemplateEntities, ForEachLivePawn } from "./bm_core";
import type { FVector, FRotator, FRotationMatrix, FColor, FModifyDamageEvent, FModifyDamageResult } from "./bm_core";
import { SpawnScorchMark, SpawnBloodSplatter, SpawnTemporaryTemplate } from "./bm_effects";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FProjectile
{
	Owner: CSPlayerPawn;
	Position: FVector;
	Velocity: FVector;
	GravityScale: number;
	SpawnedAt: number;
	Models: FProjectileModel[];
}

export interface FProjectileModel
{
	readonly Ent: Entity;
	readonly LocalRotation: FRotationMatrix;
}

export interface FBouncingProjectile extends FProjectile
{
	bTouchedWorld: boolean;
	GroundNormal: FVector | undefined;
}

export interface FBounceSettings
{
	readonly Restitution: number;
	readonly ImpactFriction: number;
	readonly RollFriction: number;
	readonly SettleSpeed: number;
}

export interface FDamageFalloff
{
	readonly RampUp: number;
	readonly FallOff: number;
	readonly OptimalDistance: number;
}

export interface FDamageCurveKey
{
	readonly Distance: number;
	readonly Scale: number;
}

export type FDamageCurve = readonly FDamageCurveKey[];

export interface FHitscanHit
{
	readonly Victim: CSPlayerPawn;
	readonly Trace: TraceResult;
}

export interface FHitscanResult
{
	readonly Hits: FHitscanHit[];
	readonly End: FVector;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const Gravity: number = 800;
const ExplosionTemplateName: string = "boom_template";
const ExplosionFxLifetime: number = 5;
const ProjectileLaunchOffset: FVector = { x: 0, y: 0, z: -8 };
const ExplosionOffset: FVector = { x: 0, y: 0, z: 6 };
const GroundedKnockbackLift: FVector = { x: 0, y: 0, z: 0.6 };
const StandingKnockbackHeight: number = 82;
const CrouchedKnockbackHeight: number = 62;
const AirborneSelfKnockbackScale: number = 1.33;
const SelfBlastDamageScale: number = 0.33;
const ExplosionDebugColor: FColor = { r: 255, g: 140, b: 0 };
const MaxHitscanTraces: number = 8;
const GroundTraceLift: FVector = { x: 0, y: 0, z: 2 };
const SurfaceGap: number = 2;
const MinGroundNormalZ: number = 0.7;
const GroundProbeDistance: number = 8;
const MinFacingSpeed: number = 1;

// Projectile //////////////////////////////////////////////////////////////////////////////////////

export function LaunchProjectile(Owner: CSPlayerPawn, Speed: number, UpSpeed: number, GravityScale: number, TemplateName: string): FProjectile
{
	const Direction: FVector = VectorMath.GetForwardVector(Owner.GetEyeAngles());
	const Start: FVector = VectorMath.Add(Owner.GetEyePosition(), ProjectileLaunchOffset);
	const Velocity: FVector = VectorMath.Add(VectorMath.Scale(Direction, Speed), { x: 0, y: 0, z: UpSpeed });
	const Projectile: FProjectile =
	{
		Owner: Owner,
		Position: Start,
		Velocity: Velocity,
		GravityScale: GravityScale,
		SpawnedAt: Instance.GetGameTime(),
		Models: SpawnProjectileModels(TemplateName, Start),
	};
	PlaceProjectileModels(Projectile, true);
	return Projectile;
}

export function MoveProjectile(Projectile: FProjectile, DeltaTime: number, bHitPlayers: boolean): TraceResult | undefined
{
	const Velocity: FVector = Projectile.Velocity;
	Projectile.Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - Gravity * Projectile.GravityScale * DeltaTime };
	const Hit: TraceResult | undefined = SweepProjectile(Projectile, DeltaTime, bHitPlayers);
	PlaceProjectileModels(Projectile, false);
	return Hit;
}

export function MoveBouncingProjectile(Projectile: FBouncingProjectile, DeltaTime: number, bHitPlayers: boolean, Bounce: FBounceSettings): CSPlayerPawn | undefined
{
	if (Projectile.GroundNormal)
	{
		return RollProjectile(Projectile, Projectile.GroundNormal, DeltaTime, bHitPlayers, Bounce);
	}

	const Hit: TraceResult | undefined = MoveProjectile(Projectile, DeltaTime, bHitPlayers);
	if (!Hit)
	{
		return undefined;
	}
	if (IsPlayerPawn(Hit.hitEntity))
	{
		return Hit.hitEntity;
	}
	BounceProjectile(Projectile, Hit.normal, Bounce);
	return undefined;
}

function RollProjectile(Projectile: FBouncingProjectile, Ground: FVector, DeltaTime: number, bHitPlayers: boolean, Bounce: FBounceSettings): CSPlayerPawn | undefined
{
	const Pull: FVector = { x: 0, y: 0, z: -Gravity * Projectile.GravityScale * DeltaTime };
	const Rolling: FVector = VectorMath.ProjectOnPlane(VectorMath.Add(Projectile.Velocity, Pull), Ground);
	const Speed: number = VectorMath.Size(Rolling);
	const SlowedSpeed: number = Math.max(0, Speed - Bounce.RollFriction * DeltaTime);
	Projectile.Velocity = Speed > 0 ? VectorMath.Scale(Rolling, SlowedSpeed / Speed) : ZeroVector;

	const Hit: TraceResult | undefined = SlowedSpeed > 0 ? SweepProjectile(Projectile, DeltaTime, bHitPlayers) : undefined;
	if (Hit && IsPlayerPawn(Hit.hitEntity))
	{
		PlaceProjectileModels(Projectile, false);
		return Hit.hitEntity;
	}
	if (Hit)
	{
		BounceProjectile(Projectile, Hit.normal, Bounce);
	}
	FollowGround(Projectile);
	PlaceProjectileModels(Projectile, false);
	return undefined;
}

function BounceProjectile(Projectile: FBouncingProjectile, Normal: FVector, Bounce: FBounceSettings): void
{
	Projectile.bTouchedWorld = true;
	const IntoSpeed: number = -VectorMath.Dot(Projectile.Velocity, Normal);
	if (IntoSpeed <= 0)
	{
		return;
	}

	const Along: FVector = VectorMath.Scale(VectorMath.ProjectOnPlane(Projectile.Velocity, Normal), 1 - Bounce.ImpactFriction);
	const OutSpeed: number = IntoSpeed * Bounce.Restitution;
	if (Normal.z >= MinGroundNormalZ && OutSpeed < Bounce.SettleSpeed)
	{
		Projectile.GroundNormal = Normal;
		Projectile.Velocity = Along;
		return;
	}
	Projectile.Velocity = VectorMath.Add(Along, VectorMath.Scale(Normal, OutSpeed));
}

function FollowGround(Projectile: FBouncingProjectile): void
{
	if (!Projectile.GroundNormal)
	{
		return;
	}
	const Trace: TraceResult = Instance.TraceLine(
	{
		start: Projectile.Position,
		end: VectorMath.Add(Projectile.Position, { x: 0, y: 0, z: -(SurfaceGap + GroundProbeDistance) }),
		ignoreEntity: GetIgnoredEntities(Projectile),
		ignorePlayers: true,
	});
	if (!Trace.didHit || Trace.normal.z < MinGroundNormalZ)
	{
		Projectile.GroundNormal = undefined;
		return;
	}
	Projectile.Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, SurfaceGap));
	Projectile.GroundNormal = Trace.normal;
	Projectile.Velocity = VectorMath.ProjectOnPlane(Projectile.Velocity, Trace.normal);
}

function SweepProjectile(Projectile: FProjectile, DeltaTime: number, bHitPlayers: boolean): TraceResult | undefined
{
	const NextPosition: FVector = VectorMath.Add(Projectile.Position, VectorMath.Scale(Projectile.Velocity, DeltaTime));
	const Trace: TraceResult = Instance.TraceLine(
	{
		start: Projectile.Position,
		end: NextPosition,
		ignoreEntity: GetIgnoredEntities(Projectile),
		ignorePlayers: !bHitPlayers,
	});

	if (Trace.didHit)
	{
		Projectile.Position = VectorMath.Add(Trace.end, VectorMath.Scale(Trace.normal, SurfaceGap));
	}
	else
	{
		Projectile.Position = NextPosition;
	}
	return Trace.didHit ? Trace : undefined;
}

function GetIgnoredEntities(Projectile: FProjectile): Entity[]
{
	const IgnoredEntities: Entity[] = [Projectile.Owner];
	for (const Model of Projectile.Models)
	{
		if (Model.Ent.IsValid())
		{
			IgnoredEntities.push(Model.Ent);
		}
	}
	return IgnoredEntities;
}

export function DestroyProjectile(Projectile: FProjectile): void
{
	for (const Model of Projectile.Models)
	{
		if (Model.Ent.IsValid())
		{
			Model.Ent.Remove();
		}
	}
	Projectile.Models = [];
}

export function TintProjectile(Projectile: FProjectile, Color: FColor): void
{
	for (const Model of Projectile.Models)
	{
		if (Model.Ent.IsValid() && IsModelEntity(Model.Ent))
		{
			Model.Ent.SetColor(Color);
		}
	}
}

function SpawnProjectileModels(TemplateName: string, Position: FVector): FProjectileModel[]
{
	const Models: FProjectileModel[] = [];
	for (const Ent of SpawnTemplateEntities(TemplateName, Position, undefined))
	{
		Models.push({ Ent: Ent, LocalRotation: RotationMath.FromRotator(Ent.GetAbsAngles()) });
	}
	return Models;
}

function PlaceProjectileModels(Projectile: FProjectile, bTeleport: boolean): void
{
	// Something that has stopped moving keeps facing the way it was
	const bTurn: boolean = VectorMath.Size(Projectile.Velocity) >= MinFacingSpeed;
	const Flight: FRotationMatrix = RotationMath.FromRotator(VectorMath.GetRotation(Projectile.Velocity));
	for (const Model of Projectile.Models)
	{
		if (!Model.Ent.IsValid() || Model.Ent.GetParent() !== undefined)
		{
			continue;
		}
		const Placement: { position: FVector, angles?: FRotator } = { position: Projectile.Position };
		if (bTurn)
		{
			Placement.angles = RotationMath.ToRotator(RotationMath.Multiply(Flight, Model.LocalRotation));
		}
		if (bTeleport)
		{
			Model.Ent.Teleport(Placement);
		}
		else
		{
			Model.Ent.Move(Placement);
		}
	}
}

export function Explode(Position: FVector, Attacker: CSPlayerPawn, Radius: number, Damage: number, Knockback: number, RangeFalloff: FDamageFalloff | undefined): void
{
	const Origin: FVector = VectorMath.Add(Position, ExplosionOffset);

	if (!SpawnTemporaryTemplate(ExplosionTemplateName, Origin, ExplosionFxLifetime))
	{
		Instance.DebugSphere({ center: Origin, radius: Radius, duration: 0.3, color: ExplosionDebugColor });
	}
	SpawnScorchMark(Position);
	if (!Attacker.IsValid())
	{
		return;
	}

	ForEachLivePawn((Victim: CSPlayerPawn): void =>
	{
		const Target: FVector = GetChestPosition(Victim);
		const Offset: FVector = VectorMath.Subtract(Target, Origin);
		const Distance: number = VectorMath.Size(Offset);
		if (Distance > Radius)
		{
			return;
		}

		const Trace: TraceResult = Instance.TraceLine({ start: Origin, end: Target, ignorePlayers: true });
		if (Trace.didHit && !Trace.startedInSolid)
		{
			return;
		}

		const bIsSelf: boolean = Victim === Attacker;
		if (!bIsSelf && !IsFriendlyFire() && Victim.GetTeamNumber() === Attacker.GetTeamNumber())
		{
			return;
		}

		const Falloff: number = 1 - 0.5 * (Distance / Radius);
		const RangeScale: number = bIsSelf ? 1 : GetRangeDamageScale(Attacker, Victim, RangeFalloff);
		const BlastDamage: number = Damage * Falloff * RangeScale;
		const Away: FVector = Distance > 1 ? Offset : UpVector;
		const Push: FVector = ApplyKnockback(Victim, Away, BlastDamage, Knockback, bIsSelf);

		const DamageTaken: number = bIsSelf ? BlastDamage * SelfBlastDamageScale : BlastDamage;
		const DamageDealt: number = Victim.TakeDamage(
		{
			damage: DamageTaken,
			damageTypes: CSDamageTypes.BLAST,
			attacker: Attacker,
			inflictor: Attacker,
		});

		if (!bIsSelf && DamageDealt > 0)
		{
			SpawnBloodSplatter(Origin, Victim);
		}

		const PushDirection: FVector = VectorMath.GetSafeNormal(Push);
		Console.Log(`${LogPrefix} ${Attacker.GetPlayerController()?.GetPlayerName()} Damaged (explosive) ${Victim.GetPlayerController()?.GetPlayerName()} : ${DamageTaken}d : ${VectorMath.Size(Push)}k (${PushDirection.x}, ${PushDirection.y}, ${PushDirection.z}) : ${Falloff}f : ${RangeScale.toFixed(2)}r`);
	});
}

// Damage Falloff /////////////////////////////////////////////////////////////////////////////////

export function GetDistanceDamageScale(Distance: number, Falloff: FDamageFalloff): number
{
	const Closeness: number = Math.min(1, Math.max(0, 1 - Distance / (2 * Falloff.OptimalDistance)));
	const Curve: number = Closeness * Closeness * (3 - 2 * Closeness);
	if (Curve >= 0.5)
	{
		return 1 + (Falloff.RampUp - 1) * (2 * Curve - 1);
	}
	return 1 - (1 - Falloff.FallOff) * (1 - 2 * Curve);
}

export function EvaluateDamageCurve(Curve: FDamageCurve, Distance: number): number
{
	const First: FDamageCurveKey | undefined = Curve[0];
	if (!First)
	{
		return 1;
	}
	if (Distance <= First.Distance)
	{
		return First.Scale;
	}
	for (let Index: number = 1; Index < Curve.length; Index++)
	{
		const Previous: FDamageCurveKey | undefined = Curve[Index - 1];
		const Next: FDamageCurveKey | undefined = Curve[Index];
		if (Previous && Next && Distance <= Next.Distance)
		{
			const Alpha: number = (Distance - Previous.Distance) / Math.max(1, Next.Distance - Previous.Distance);
			return Previous.Scale + (Next.Scale - Previous.Scale) * Alpha;
		}
	}
	const Last: FDamageCurveKey | undefined = Curve[Curve.length - 1];
	return Last ? Last.Scale : 1;
}

function GetRangeDamageScale(Attacker: CSPlayerPawn, Victim: CSPlayerPawn, Falloff: FDamageFalloff | undefined): number
{
	if (!Falloff)
	{
		return 1;
	}
	const Distance: number = VectorMath.Size(VectorMath.Subtract(GetChestPosition(Victim), GetChestPosition(Attacker)));
	return GetDistanceDamageScale(Distance, Falloff);
}

// Hitscan /////////////////////////////////////////////////////////////////////////////////////////

export function TraceHitscan(Shooter: CSPlayerPawn, Start: FVector, End: FVector, MaxHits: number): FHitscanResult
{
	const Ignored: Entity[] = [Shooter];
	const Hits: FHitscanHit[] = [];
	let StopPoint: FVector = End;
	for (let TraceCount: number = 0; TraceCount < MaxHitscanTraces; TraceCount++)
	{
		const Trace: TraceResult = Instance.TraceLine({ start: Start, end: End, ignoreEntity: Ignored, traceHitboxes: true });
		if (!Trace.didHit)
		{
			StopPoint = End;
			break;
		}
		StopPoint = Trace.end;

		const Victim: Entity | undefined = Trace.hitEntity;
		if (!IsPlayerPawn(Victim))
		{
			break;
		}
		Ignored.push(Victim);
		if (!Victim.IsAlive() || (!IsFriendlyFire() && Victim.GetTeamNumber() === Shooter.GetTeamNumber()))
		{
			continue;
		}
		Hits.push({ Victim: Victim, Trace: Trace });
		if (Hits.length >= MaxHits)
		{
			break;
		}
	}
	return { Hits: Hits, End: StopPoint };
}

export function GetSpreadDirection(Aim: FRotator, SpreadDegrees: number): FVector
{
	const Radius: number = SpreadDegrees * Math.sqrt(Math.random());
	const Around: number = Math.random() * Math.PI * 2;
	return VectorMath.GetForwardVector(
	{
		pitch: Aim.pitch + Radius * Math.sin(Around),
		yaw: Aim.yaw + Radius * Math.cos(Around),
		roll: 0,
	});
}

export function ApplyKnockback(Victim: CSPlayerPawn, Direction: FVector, Damage: number, Strength: number, bIsSelf: boolean): FVector
{
	const bOnGround: boolean = Victim.GetGroundEntity() !== undefined;
	const bCrouched: boolean = Victim.IsDucking() || Victim.IsDucked();

	let Push: FVector = VectorMath.GetSafeNormal(Direction);
	if (bOnGround)
	{
		Push = VectorMath.GetSafeNormal(VectorMath.Add(Push, GroundedKnockbackLift));
	}

	let Scale: number = Strength;
	if (bIsSelf && !bOnGround)
	{
		Scale *= AirborneSelfKnockbackScale;
	}

	const Speed: number = (Damage * Scale) / (bCrouched ? CrouchedKnockbackHeight : StandingKnockbackHeight);
	if (Speed === 0)
	{
		return ZeroVector;
	}
	const Velocity: FVector = VectorMath.Scale(Push, Speed);
	Victim.Teleport({ velocity: VectorMath.Add(Victim.GetAbsVelocity(), Velocity) });
	return Velocity;
}

export function GetHeightAboveGround(Pawn: CSPlayerPawn, MaxDistance: number): number
{
	if (Pawn.GetGroundEntity())
	{
		return 0;
	}
	const Start: FVector = VectorMath.Add(Pawn.GetAbsOrigin(), GroundTraceLift);
	const Trace: TraceResult = Instance.TraceLine(
	{
		start: Start,
		end: VectorMath.Add(Start, { x: 0, y: 0, z: -(MaxDistance + GroundTraceLift.z) }),
		ignorePlayers: true,
	});
	if (!Trace.didHit)
	{
		return MaxDistance;
	}
	return Trace.startedInSolid ? 0 : Math.max(0, Start.z - Trace.end.z - GroundTraceLift.z);
}

export function ApplyBulletFalloff(Event: FModifyDamageEvent, Falloff: FDamageFalloff | undefined): FModifyDamageResult
{
	const Attacker: Entity | undefined = Event.attacker;
	const Weapon: CSWeaponBase | undefined = Event.weapon;
	const bIsBullet: boolean = (Event.damageTypes & (CSDamageTypes.BULLET | CSDamageTypes.BUCKSHOT)) !== 0;
	if (!Falloff || !Weapon || !bIsBullet || !IsPlayerPawn(Attacker) || Attacker === Event.player)
	{
		return;
	}
	if (Weapon.GetData().GetType() === CSWeaponType.KNIFE)
	{
		return;
	}

	// CS2 already scaled the damage by RangeModifier ^ (distance / 500), so undo that first
	const BulletTravel: number = VectorMath.Size(VectorMath.Subtract(GetChestPosition(Event.player), Attacker.GetEyePosition()));
	const CsRangeScale: number = Math.pow(Weapon.GetData().GetRangeModifier(), BulletTravel / 500);
	const RangeScale: number = GetRangeDamageScale(Attacker, Event.player, Falloff);
	const Damage: number = Math.max(1, Math.round((Event.damage / CsRangeScale) * RangeScale));

	Console.Log(`${LogPrefix} ${Attacker.GetPlayerController()?.GetPlayerName()} Damaged (Bullet) ${Event.player.GetPlayerController()?.GetPlayerName()} : ${Damage}d : ${Math.round(BulletTravel)}u x${RangeScale.toFixed(2)}`);

	return { damage: Damage };
}