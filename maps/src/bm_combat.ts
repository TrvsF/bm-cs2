import { Instance, CSDamageTypes, CSWeaponType } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSWeaponBase, TraceResult } from "cs_script/point_script";
import { bDebug, bFriendlyFire, LogPrefix, UpVector, FVectorMath, IsValid, IsPlayerPawn, GetChestPosition, SpawnFromTemplate, ForEachLivePawn } from "./bm_core";
import type { FVector, FColor, FModifyDamageEvent, FModifyDamageResult } from "./bm_core";
import { SpawnScorchMark, SpawnBloodSplatter } from "./bm_effects";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FProjectile
{
	Owner: CSPlayerPawn;
	Position: FVector;
	Velocity: FVector;
	GravityScale: number;
	SpawnedAt: number;
	Model: Entity | undefined;
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

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const Gravity: number = 800;
const ExplosionTemplateName: string = "boom_template";
const ProjectileLaunchOffset: FVector = { x: 0, y: 0, z: -8 };
const ExplosionOffset: FVector = { x: 0, y: 0, z: 6 };
const GroundedKnockbackLift: FVector = { x: 0, y: 0, z: 0.6 };
const ExplosionDebugColor: FColor = { r: 255, g: 140, b: 0 };
const GroundTraceLift: FVector = { x: 0, y: 0, z: 2 };   // ground traces start just above the feet, so they don't begin inside the floor

// Projectile //////////////////////////////////////////////////////////////////////////////////////

export function LaunchProjectile(Owner: CSPlayerPawn, Speed: number, UpSpeed: number, GravityScale: number, TemplateName: string): FProjectile
{
	const Direction: FVector = FVectorMath.GetForwardVector(Owner.GetEyeAngles());
	const Start: FVector = FVectorMath.Add(Owner.GetEyePosition(), ProjectileLaunchOffset);
	const Projectile: FProjectile =
	{
		Owner: Owner,
		Position: Start,
		Velocity: FVectorMath.Add(FVectorMath.Scale(Direction, Speed), { x: 0, y: 0, z: UpSpeed }),
		GravityScale: GravityScale,
		SpawnedAt: Instance.GetGameTime(),
		Model: SpawnFromTemplate(TemplateName, Start),
	};
	return Projectile;
}

export function MoveProjectile(Projectile: FProjectile, DeltaTime: number, bHitPlayers: boolean): TraceResult | undefined
{
	const Velocity: FVector = Projectile.Velocity;
	Projectile.Velocity = { x: Velocity.x, y: Velocity.y, z: Velocity.z - Gravity * Projectile.GravityScale * DeltaTime };
	const NextPosition: FVector = FVectorMath.Add(Projectile.Position, FVectorMath.Scale(Projectile.Velocity, DeltaTime));
	const IgnoredEntities: Entity[] = IsValid(Projectile.Model) ? [Projectile.Owner, Projectile.Model] : [Projectile.Owner];
	const Trace: TraceResult = Instance.TraceLine(
	{
		start: Projectile.Position,
		end: NextPosition,
		ignoreEntity: IgnoredEntities,
		ignorePlayers: !bHitPlayers,
	});

	if (Trace.didHit)
	{
		Projectile.Position = FVectorMath.Add(Trace.end, FVectorMath.Scale(Trace.normal, 2));
	}
	else
	{
		Projectile.Position = NextPosition;
	}

	if (IsValid(Projectile.Model))
	{
		Projectile.Model.Teleport({ position: Projectile.Position });
	}
	return Trace.didHit ? Trace : undefined;
}

export function DestroyProjectile(Projectile: FProjectile): void
{
	if (IsValid(Projectile.Model))
	{
		Projectile.Model.Remove();
	}
}

export function Explode(Position: FVector, Attacker: CSPlayerPawn, Radius: number, Damage: number, Knockback: number, RangeFalloff: FDamageFalloff | undefined): void
{
	const Origin: FVector = FVectorMath.Add(Position, ExplosionOffset);

	if (!SpawnFromTemplate(ExplosionTemplateName, Origin))
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
		const Offset: FVector = FVectorMath.Subtract(Target, Origin);
		const Distance: number = FVectorMath.Size(Offset);
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
		if (!bIsSelf && !bFriendlyFire && Victim.GetTeamNumber() === Attacker.GetTeamNumber())
		{
			return;
		}

		const Falloff: number = 1 - 0.5 * (Distance / Radius);

		const RangeScale: number = bIsSelf ? 1 : GetRangeDamageScale(Attacker, Victim, RangeFalloff);
		let CalculatedDmg: number = Damage * Falloff * RangeScale;

		// do knockback
        const IsCrouched: boolean = Victim.IsDucking() || Victim.IsDucked();
        let Direction: FVector = Distance > 1 ? FVectorMath.GetSafeNormal(Offset) : UpVector;
        if (Victim.GetGroundEntity())
        {
            Direction = FVectorMath.GetSafeNormal(FVectorMath.Add(Direction, GroundedKnockbackLift));
        }

        const CrouchFactor: number = IsCrouched ? 62 : 82;
        let KBStrength: number = Knockback;
        if (!Victim.GetGroundEntity() && bIsSelf)
        {
            KBStrength *= 1.33;
        }

        const CalculatedKb: number = CalculatedDmg * (KBStrength / CrouchFactor);
        Victim.Teleport({ velocity: FVectorMath.Add(Victim.GetAbsVelocity(), FVectorMath.Scale(Direction, CalculatedKb)) });

		if (bIsSelf)
		{
			CalculatedDmg *= 0.33;
		}

		const DamageDealt: number = Victim.TakeDamage(
		{
			damage: CalculatedDmg,
			damageTypes: CSDamageTypes.BLAST,
			attacker: Attacker,
			inflictor: Attacker,
		});

		if (!bIsSelf && DamageDealt > 0)
		{
			SpawnBloodSplatter(Origin, Victim);
		}

		Instance.Msg(`${LogPrefix} ${Attacker.GetPlayerController()?.GetPlayerName()} Damaged ${Victim.GetPlayerController()?.GetPlayerName()} : ${CalculatedDmg}d : ${CalculatedKb}k (${Direction.x}, ${Direction.y}, ${Direction.z}) : ${Falloff}f : ${RangeScale.toFixed(2)}r`);
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
	const Distance: number = FVectorMath.Size(FVectorMath.Subtract(GetChestPosition(Victim), GetChestPosition(Attacker)));
	return GetDistanceDamageScale(Distance, Falloff);
}

export function GetHeightAboveGround(Pawn: CSPlayerPawn, MaxDistance: number): number
{
	if (Pawn.GetGroundEntity())
	{
		return 0;
	}
	const Start: FVector = FVectorMath.Add(Pawn.GetAbsOrigin(), GroundTraceLift);
	const Trace: TraceResult = Instance.TraceLine(
	{
		start: Start,
		end: FVectorMath.Add(Start, { x: 0, y: 0, z: -(MaxDistance + GroundTraceLift.z) }),
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
	const BulletTravel: number = FVectorMath.Size(FVectorMath.Subtract(GetChestPosition(Event.player), Attacker.GetEyePosition()));
	const CsRangeScale: number = Math.pow(Weapon.GetData().GetRangeModifier(), BulletTravel / 500);
	const RangeScale: number = GetRangeDamageScale(Attacker, Event.player, Falloff);
	const Damage: number = Math.max(1, Math.round((Event.damage / CsRangeScale) * RangeScale));

	if (bDebug)
	{
		Instance.Msg(`${LogPrefix} bullet falloff: ${Math.round(BulletTravel)}u x${RangeScale.toFixed(2)} (${Math.round(Event.damage)} -> ${Damage})`);
	}
	return { damage: Damage };
}