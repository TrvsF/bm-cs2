import { Instance, CSInputs, CSDamageTypes, CSWeaponType } from "cs_script/point_script";
import type
{
	Entity,
	CSPlayerPawn,
	CSPlayerController,
	CSWeaponBase,
	CSWeaponData,
	PointTemplate,
	CustomHudLayout,
	TraceResult,
	Vector,
	QAngle,
	ColorArg,
} from "cs_script/point_script";
import { EPlayerClass, DemoSettings, MedicSettings, ClassDefinitions, GiveLoadout, RestoreDefaultBody } from "./bm_classes";
import type { EPlayableClass } from "./bm_classes";

export const bDebug: boolean = true;
export const TickInterval: number = 1 / 64;
const Gravity: number = 800

// Types ///////////////////////////////////////////////////////////////////////////////////////////

type FVector = Vector;
type FRotator = QAngle;
type FColor = ColorArg;

// Pulls the event struct out of an Instance.OnXxx(Callback) binder, so these never drift from Valve's typings
type TEventOf<TBinder> = TBinder extends (Callback: infer TCallback) => void
	? TCallback extends (Event: infer TEvent) => unknown ? TEvent : never
	: never;

type FPlayerChatEvent = TEventOf<typeof Instance.OnPlayerChat>;
type FPlayerResetEvent = TEventOf<typeof Instance.OnPlayerReset>;
type FPlayerKillEvent = TEventOf<typeof Instance.OnPlayerKill>;
type FPlayerDisconnectEvent = TEventOf<typeof Instance.OnPlayerDisconnect>;
type FGunFireEvent = TEventOf<typeof Instance.OnGunFire>;
type FPlayerDamageEvent = TEventOf<typeof Instance.OnPlayerDamage>;
export type FModifyDamageEvent = TEventOf<typeof Instance.OnModifyPlayerDamage>;
export type FModifyDamageResult = ReturnType<Parameters<typeof Instance.OnModifyPlayerDamage>[0]>;

enum ETeam
{
	Unassigned = 0,
	Spectator = 1,
	Terrorist = 2,
	CounterTerrorist = 3,
}

export interface FProjectile
{
	Owner: CSPlayerPawn;
	Position: FVector;
	Velocity: FVector;
	GravityScale: number;
	SpawnedAt: number;
	Model: Entity | undefined;
}

// TF2-style damage scaling by attacker-to-victim distance.
// Damage is 100% at OptimalDistance, RampUp at point blank, and FallOff at twice OptimalDistance or further.
export interface FDamageFalloff
{
	readonly RampUp: number;
	readonly FallOff: number;
	readonly OptimalDistance: number;
}

export interface FStickyBomb extends FProjectile
{
	bStuck: boolean;
	ArmedAt: number;
}

export interface FPlayerState
{
	Stickies: FStickyBomb[];
	bDetonateHeld: boolean;
	HealTarget: CSPlayerPawn | undefined;
	HealAccumulator: number;
	DecayAccumulator: number;
	UberCharge: number;
	UberEndTime: number;
	DamageTotal: number;
	LastDamageTime: number;
	bDamagePopA: boolean;
}

enum EBotMode
{
	Still,
	Run,
	Jump,
}

interface FBotAssignment
{
	Marker: Entity;
	Mode: EBotMode;
	Yaw: number;
	bPlaced: boolean;    // false until the bot has been moved onto its marker (again, after each respawn)
}

interface FPendingTimer
{
	FireTime: number;
	Callback: () => void;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const INDEX_NONE: number = -1;
const MaxPlayerSlots: number = 64;
const LogPrefix: string = "[BM]";
const ExplosionTemplateName: string = "boom_template";
const ScorchTemplateName: string = "scorch_template";
const BloodTemplateName: string = "blood_template";
const MaxDecals: number = 48;                 // past this, the oldest decal is removed
const ScorchSearchDistance: number = 16;      // explosions further than this from any surface leave no scorch
const BloodSplatterDistance: number = 128;    // how far behind (or below) a victim their blood can land

// Name an info_target one of these in Hammer and a bot will be placed on it, facing the same way, in that mode
const BotMarkerModes: ReadonlyMap<string, EBotMode> = new Map<string, EBotMode>(
	[
		["bot_still", EBotMode.Still],
		["bot_run", EBotMode.Run],
		["bot_jump", EBotMode.Jump],
	]
);
const BotRunSpeed: number = 250;              // knife speed
const BotJumpSpeed: number = 301;             // CS2's normal jump
const BotSpawnSettleTime: number = 0.1;       // wait after a bot spawns before moving it to its marker
const BotTurnCheckDistance: number = 40;      // runners turn around this close to a wall or a drop
const BotLedgeCheckDepth: number = 64;        // a drop deeper than this counts as a ledge
const DamageHudName: string = "damage_hud";
const DamageLabelId: string = "DamageNumber";
const DamageBatchWindow: number = 0.6;
const DamageShowTime: number = 0.85;

const UpVector: FVector = { x: 0, y: 0, z: 1 };
const ZeroVector: FVector = { x: 0, y: 0, z: 0 };
const ChestOffset: FVector = { x: 0, y: 0, z: 40 };
const ProjectileLaunchOffset: FVector = { x: 0, y: 0, z: -8 };
const ExplosionOffset: FVector = { x: 0, y: 0, z: 6 };
const GroundedKnockbackLift: FVector = { x: 0, y: 0, z: 0.6 };
const BeamStartDrop: FVector = { x: 0, y: 0, z: 12 };

const TerroristColor: FColor = { r: 220, g: 60, b: 50 };
const CounterTerroristColor: FColor = { r: 70, g: 130, b: 230 };
const UnarmedStickyColor: FColor = { r: 120, g: 120, b: 120 };
const ExplosionDebugColor: FColor = { r: 255, g: 140, b: 0 };
const UberReadyColor: FColor = { r: 255, g: 255, b: 255 };

const ClassChatCommands: ReadonlyMap<string, EPlayerClass> = new Map<string, EPlayerClass>(
	[
		["!demo", EPlayerClass.Demoman],
		["!medic", EPlayerClass.Medic],
		["!solider", EPlayerClass.Solider],
		["!none", EPlayerClass.None],
	]
);

// Main ///////////////////////////////////////////////////////////////////////////////////////////

function TickTimers(Now: number): void
{
	for (let Index: number = GPendingTimers.length - 1; Index >= 0; Index--)
	{
		const Timer: FPendingTimer | undefined = GPendingTimers[Index];
		if (Timer && Timer.FireTime <= Now)
		{
			GPendingTimers.splice(Index, 1);
			Timer.Callback();
		}
	}
}

function Tick(): void
{
	const Now: number = Instance.GetGameTime();
	Instance.SetNextThink(Now + TickInterval);
	const DeltaTime: number = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
	GLastThinkTime = Now;

	try
	{
		TickMatch(Now);
		TickTimers(Now);

		for (const Definition of Object.values(ClassDefinitions))
		{
			Definition.TickWorld(Now, DeltaTime);
		}

		const HealedPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
		const UberedPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
		let HudLine: number = 0;
		ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
		{
			const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
			if (PlayerClass === EPlayerClass.Demoman)
			{
				TickDemoman(Pawn, Slot, Now, DeltaTime);
			}
			else if (PlayerClass === EPlayerClass.Medic)
			{
				TickMedic(Pawn, Slot, Now, DeltaTime, HealedPawns, UberedPawns, HudLine++);
			}
		});
		TickOverhealDecay(HealedPawns, DeltaTime);
		UpdateUberGlows(UberedPawns);
		GUberedPawns = UberedPawns;
		TickBots(Now); // last, so a problem here can't stop the gameplay above
	}
	catch (Exception: unknown)
	{
		Instance.Msg(`${LogPrefix} error: ${String(Exception)}`);
	}
}

function BeginPlay(): void
{
	Instance.OnPlayerChat(HandlePlayerChat);
	Instance.OnPlayerReset(HandlePlayerReset);
	Instance.OnPlayerKill(HandlePlayerKill);
	Instance.OnPlayerDisconnect(HandlePlayerDisconnect);
	Instance.OnRoundStart(HandleRoundStart);
	Instance.OnGunFire(HandleGunFire);
	Instance.OnPlayerDamage(HandlePlayerDamage);
	Instance.OnModifyPlayerDamage(HandleModifyPlayerDamage);

	Instance.SetThink(Tick);
	Instance.SetNextThink(Instance.GetGameTime());
	Instance.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}`);
}

BeginPlay(); // !

// Handle /////////////////////////////////////////////////////////////////////////////////////////
// TODO : this Handle block should have as little logic as possible ///////////////////////////////

function HandlePlayerChat(Event: FPlayerChatEvent): void
{
	const Player: CSPlayerController | undefined = Event.player;
	if (!Player)
	{
		return;
	}

	const Command: string = Event.text.trim().toLowerCase();
	if (bDebug && Command === "!hudtest")
	{
		ShowDamageNumber(Player.GetPlayerSlot(), 123);
		return;
	}

	const PlayerClass: EPlayerClass | undefined = ClassChatCommands.get(Command);
	if (PlayerClass === undefined)
	{
		return;
	}

	const Slot: number = Player.GetPlayerSlot();
	ClearPlayer(Slot);

	const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
	if (PlayerClass === EPlayerClass.None)
	{
		GClassBySlot.delete(Slot);
		if (Pawn && Pawn.IsAlive())
		{
			RestoreDefaultBody(Pawn);
		}
	}
	else
	{
		GClassBySlot.set(Slot, PlayerClass);
		if (Pawn && Pawn.IsAlive())
		{
			GiveLoadout(Pawn, PlayerClass);
		}
	}

	const ClassLabel: string = PlayerClass === EPlayerClass.None ? "normal" : PlayerClass;
	Instance.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}

function HandlePlayerReset(Event: FPlayerResetEvent): void
{
	const Pawn: CSPlayerPawn = Event.player;
	const Slot: number = GetPlayerSlot(Pawn);
	if (Slot === INDEX_NONE)
	{
		return;
	}

	ClearPlayer(Slot);
	ResetBotMode(Slot);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
	if (PlayerClass === undefined)
	{
		return;
	}

	// Small delay so the default spawn loadout doesn't overwrite ours
	SetTimer(0.1, (): void =>
	{
		if (Pawn.IsValid() && Pawn.IsAlive())
		{
			GiveLoadout(Pawn, PlayerClass);
		}
	});
}

function HandlePlayerKill(Event: FPlayerKillEvent): void
{
	const Slot: number = GetPlayerSlot(Event.player);
	if (Slot !== INDEX_NONE)
	{
		ClearPlayer(Slot);
	}
}

function HandlePlayerDisconnect(Event: FPlayerDisconnectEvent): void
{
	ClearPlayer(Event.playerSlot);
	ReleaseBotMarker(Event.playerSlot);
	GBotReadyAt.delete(Event.playerSlot);
	ResetDamageNumbers(Event.playerSlot);
	GClassBySlot.delete(Event.playerSlot);
	GPlayerStates.delete(Event.playerSlot);
}

function HandleRoundStart(): void
{
	for (const Slot of GPlayerStates.keys())
	{
		ClearPlayer(Slot);
	}
	for (const Definition of Object.values(ClassDefinitions))
	{
		Definition.OnRoundStart();
	}
	ClearDecals();
	ApplyMatchSettings();
	Instance.Msg(`${LogPrefix} match settings applied`);
}

function HandleGunFire(Event: FGunFireEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	const Pawn: CSPlayerPawn | undefined = Weapon.GetOwner();
	const Slot: number = GetPlayerSlot(Pawn);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
	if (!Pawn || PlayerClass === undefined)
	{
		return;
	}

	const Definition = ClassDefinitions[PlayerClass];
	if (IsWeapon(Weapon, Definition.Settings.Primary))
	{
		Definition.OnPrimaryFire(Pawn, Slot, Instance.GetGameTime());
	}
}

function HandlePlayerDamage(Event: FPlayerDamageEvent): void
{
	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	if (AttackerSlot === INDEX_NONE || Event.attacker === Event.player)
	{
		return;
	}
	ShowDamageNumber(AttackerSlot, Event.damage);
}

function HandleModifyPlayerDamage(Event: FModifyDamageEvent): FModifyDamageResult
{
	if (GUberedPawns.has(Event.player))
	{
		return { abort: true };
	}

	// fall-damage
	if ((Event.damageTypes & CSDamageTypes.FALL) !== 0 && GClassBySlot.has(GetPlayerSlot(Event.player)))
	{
		// const FallSpeed: number = 580 + Event.damage * (1024 - 580) / 100; // undoes cs2's fall formula
		// if (FallSpeed <= 650)
		// {
		// 	return { abort: true };
		// }
		// return { damage: Math.round(5 * (FallSpeed / 300) * (Event.player.GetMaxHealth() / 100)) };
		
		return { abort: true };
	}
	
	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	const AttackerClass: EPlayableClass | undefined = GClassBySlot.get(AttackerSlot);
	if (AttackerClass === undefined)
	{
		return;
	}

	return ClassDefinitions[AttackerClass].ModifyOutgoingDamage(Event);
}

// Globals ////////////////////////////////////////////////////////////////////////////////////////

const GClassBySlot: Map<number, EPlayableClass> = new Map<number, EPlayableClass>();
const GPlayerStates: Map<number, FPlayerState> = new Map<number, FPlayerState>();
const GPendingTimers: FPendingTimer[] = [];
let GUberedPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
let GGlowingPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
let GLastThinkTime: number = 0;
let GbWarnedNoDamageHud: boolean = false;
let GDecals: Entity[][] = [];
const GBotAssignments: Map<number, FBotAssignment> = new Map<number, FBotAssignment>();
const GBotReadyAt: Map<number, number> = new Map<number, number>();

export function GetPlayerState(Slot: number): FPlayerState
{
	let State: FPlayerState | undefined = GPlayerStates.get(Slot);
	if (!State)
	{
		State =
		{
			Stickies: [],
			bDetonateHeld: false,
			HealTarget: undefined,
			HealAccumulator: 0,
			DecayAccumulator: 0,
			UberCharge: 0,
			UberEndTime: 0,
			DamageTotal: 0,
			LastDamageTime: 0,
			bDamagePopA: false,
		};
		GPlayerStates.set(Slot, State);
	}
	return State;
}

// Match //////////////////////////////////////////////////////////////////////////////////////////

function ApplyMatchSettings(): void
{
	const Commands: string[] = [];
	
	if (bDebug)
	{
		Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
		Commands.push("mp_roundtime 60", "mp_roundtime_defuse 60", "mp_roundtime_hostage 60", "mp_timelimit 0", "mp_maxrounds 0");
		Commands.push("mp_ignore_round_win_conditions 1", "mp_respawn_on_death_t 1", "mp_respawn_on_death_ct 1");
		Commands.push("sv_infinite_ammo 1");
		Commands.push("bot_quota_mode fill", "bot_quota 8", "bot_join_team any", "bot_stop 1");
	}
	
	for (const Command of Commands)
	{
		Instance.ServerCommand(Command);
	}
}

function TickMatch(Now: number): void
{
	if (bDebug && Instance.IsWarmupPeriod())
	{
		Instance.ServerCommand("mp_warmup_end");
	}
}

// Player //////////////////////////////////////////////////////////////////////////////////////////

function ClearPlayer(Slot: number): void
{
	const State: FPlayerState | undefined = GPlayerStates.get(Slot);
	if (!State)
	{
		return;
	}
	for (const Sticky of State.Stickies)
	{
		DestroyProjectile(Sticky);
	}
	State.Stickies = [];
	State.HealTarget = undefined;
	State.UberCharge = 0;
	State.UberEndTime = 0;
}

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

// Moves a projectile one tick. Returns the trace if it hit something.
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
		Projectile.Position = FVectorMath.Add(Trace.end, FVectorMath.Scale(Trace.normal, 2)); // sit just off the surface
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
		if (!bIsSelf && Victim.GetTeamNumber() === Attacker.GetTeamNumber())
		{
			return;
		}

		const Falloff: number = 1 - 0.5 * (Distance / Radius);

		// Distance between the two players, not to the explosion. Never applies to yourself, so blast jumps stay consistent.
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

		// No blood for blast jumps, or for hits that über (or anything else) blocked
		if (!bIsSelf && DamageDealt > 0)
		{
			SpawnBloodSplatter(Origin, Victim);
		}

		Instance.Msg(`${LogPrefix} ${Attacker.GetPlayerController()?.GetPlayerName()} Damaged ${Victim.GetPlayerController()?.GetPlayerName()} : ${CalculatedDmg}d : ${CalculatedKb}k (${Direction.x}, ${Direction.y}, ${Direction.z}) : ${Falloff}f : ${RangeScale.toFixed(2)}r`);
	});
}

// Damage Falloff /////////////////////////////////////////////////////////////////////////////////

// TF2's curve: a smooth S between FallOff (far) and RampUp (close), crossing 100% at OptimalDistance
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

function GetRangeDamageScale(Attacker: CSPlayerPawn, Victim: CSPlayerPawn, Falloff: FDamageFalloff | undefined): number
{
	if (!Falloff)
	{
		return 1;
	}
	const Distance: number = FVectorMath.Size(FVectorMath.Subtract(GetChestPosition(Victim), GetChestPosition(Attacker)));
	return GetDistanceDamageScale(Distance, Falloff);
}

// For hitscan classes to call from ModifyOutgoingDamage. Swaps CS2's own range drop-off for the TF2 curve, so the two don't stack.
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

// Demo //////////////////////////////////////////////////////////////////////////////////////////

function StepSticky(Sticky: FStickyBomb, DeltaTime: number, Now: number): boolean
{
	if (!Sticky.bStuck && MoveProjectile(Sticky, DeltaTime, false))
	{
		Sticky.bStuck = true;
	}
	return true;
}

function TickDemoman(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
{
	const State: FPlayerState = GetPlayerState(Slot);
	State.Stickies = State.Stickies.filter((Sticky: FStickyBomb): boolean =>
	{
		const bKeep: boolean = StepSticky(Sticky, DeltaTime, Now);
		if (!bKeep)
		{
			DestroyProjectile(Sticky);
		}
		return bKeep;
	});

	for (const Sticky of State.Stickies)
	{
		if (!Sticky.Model)
		{
			const Color: FColor = Now >= Sticky.ArmedAt ? GetTeamColor(Pawn) : UnarmedStickyColor;
			Instance.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: Color });
		}
	}

	const bDown: boolean = Pawn.IsInputPressed(DemoSettings.DetonateKey);
	const bPressed: boolean = bDown && !State.bDetonateHeld;
	State.bDetonateHeld = bDown;
	if (!bPressed)
	{
		return;
	}

	const StillArming: FStickyBomb[] = [];
	for (const Sticky of State.Stickies)
	{
		if (Now < Sticky.ArmedAt)
		{
			StillArming.push(Sticky);
			continue;
		}
		DestroyProjectile(Sticky);
		const bYoungSticky: boolean = Now - Sticky.SpawnedAt < DemoSettings.StickyFalloffTime;
		const RangeFalloff: FDamageFalloff | undefined = bYoungSticky ? DemoSettings.StickyFalloff : undefined;
		Explode(Sticky.Position, Pawn, DemoSettings.Radius, DemoSettings.Damage, DemoSettings.Knockback, RangeFalloff);
	}
	State.Stickies = StillArming;
}

// Medic //////////////////////////////////////////////////////////////////////////////////////////

function IsHealTargetValid(Medic: CSPlayerPawn, Target: CSPlayerPawn): boolean
{
	if (!Target.IsValid() || !Target.IsAlive() || Target.GetTeamNumber() !== Medic.GetTeamNumber())
	{
		return false;
	}
	const EyePosition: FVector = Medic.GetEyePosition();
	const TargetChest: FVector = GetChestPosition(Target);
	if (FVectorMath.Size(FVectorMath.Subtract(TargetChest, EyePosition)) > MedicSettings.BreakRange)
	{
		return false;
	}
	return !Instance.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
}

function AcquireHealTarget(Medic: CSPlayerPawn): CSPlayerPawn | undefined
{
	const EyePosition: FVector = Medic.GetEyePosition();
	const Forward: FVector = FVectorMath.GetForwardVector(Medic.GetEyeAngles());
	const End: FVector = FVectorMath.Add(EyePosition, FVectorMath.Scale(Forward, MedicSettings.Range));
	const HitEntity: Entity | undefined = Instance.TraceSphere({ start: EyePosition, end: End, radius: 12, ignoreEntity: Medic }).hitEntity;
	if (IsPlayerPawn(HitEntity) && HitEntity.IsAlive() && HitEntity.GetTeamNumber() === Medic.GetTeamNumber())
	{
		return HitEntity;
	}
	return undefined;
}

function TickMedic(
	Pawn: CSPlayerPawn,
	Slot: number,
	Now: number,
	DeltaTime: number,
	HealedPawns: Set<CSPlayerPawn>,
	UberedPawns: Set<CSPlayerPawn>,
	HudLine: number
): void
{
	const State: FPlayerState = GetPlayerState(Slot);
	const ActiveWeapon: CSWeaponBase | undefined = Pawn.GetActiveWeapon();
	const bHoldingMedigun: boolean = !!ActiveWeapon && ActiveWeapon.GetData().GetType() === CSWeaponType.KNIFE;
	const bFiring: boolean = bHoldingMedigun && Pawn.IsInputPressed(CSInputs.ATTACK);

	let Target: CSPlayerPawn | undefined = bFiring ? State.HealTarget : undefined;
	if (Target && !IsHealTargetValid(Pawn, Target))
	{
		Target = undefined;
	}
	if (bFiring && !Target)
	{
		Target = AcquireHealTarget(Pawn);
	}
	State.HealTarget = Target;

	if (Target)
	{
		HealedPawns.add(Target);
		const MaxHealth: number = Target.GetMaxHealth();
		const OverhealCap: number = Math.floor(MaxHealth * MedicSettings.OverhealMult);
		const Health: number = Target.GetHealth();
		if (Health < OverhealCap)
		{
			State.HealAccumulator += MedicSettings.HealPerSec * DeltaTime;
			const WholeHealth: number = Math.floor(State.HealAccumulator);
			if (WholeHealth > 0)
			{
				Target.SetHealth(Math.min(OverhealCap, Health + WholeHealth));
				State.HealAccumulator -= WholeHealth;
			}
		}
		if (Now >= State.UberEndTime)
		{
			const ChargeRate: number = (100 / MedicSettings.UberSecondsToFill) * (Health < MaxHealth ? 1 : 0.5); // slower on topped-up patients
			State.UberCharge = Math.min(100, State.UberCharge + ChargeRate * DeltaTime);
		}
		// Placeholder beam (tools mode only). Swap for an env_beam for real servers.
		Instance.DebugLine(
		{
			start: FVectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
			end: GetChestPosition(Target),
			duration: TickInterval * 2,
			color: GetTeamColor(Pawn),
		});
	}

	if (Now >= State.UberEndTime && State.UberCharge >= 100 && bHoldingMedigun && Pawn.IsInputPressed(CSInputs.ATTACK2))
	{
		State.UberEndTime = Now + MedicSettings.UberDuration;
	}

	const bUberActive: boolean = Now < State.UberEndTime;
	if (bUberActive)
	{
		State.UberCharge = (100 * (State.UberEndTime - Now)) / MedicSettings.UberDuration;
		UberedPawns.add(Pawn);
		if (Target)
		{
			UberedPawns.add(Target);
		}
	}

	// Placeholder meter (tools mode only)
	const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
	const MedicName: string = Controller ? Controller.GetPlayerName() : "medic";
	const ActiveText: string = bUberActive ? "  ACTIVE" : "";
	const PatientText: string = Target ? `  | patient ${Target.GetHealth()} HP` : "";
	Instance.DebugScreenText(
	{
		text: `${MedicName}  ÜBER ${Math.floor(State.UberCharge)}%${ActiveText}${PatientText}`,
		x: 40,
		y: 220 + HudLine * 18,
		duration: TickInterval * 2,
		color: State.UberCharge >= 100 ? UberReadyColor : GetTeamColor(Pawn),
	});
}

function TickOverhealDecay(HealedPawns: ReadonlySet<CSPlayerPawn>, DeltaTime: number): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const State: FPlayerState = GetPlayerState(Slot);
		const MaxHealth: number = Pawn.GetMaxHealth();
		const Health: number = Pawn.GetHealth();
		if (Health > MaxHealth && !HealedPawns.has(Pawn))
		{
			State.DecayAccumulator += MedicSettings.OverhealDecayPerSec * DeltaTime;
			const WholeDecay: number = Math.floor(State.DecayAccumulator);
			if (WholeDecay > 0)
			{
				Pawn.SetHealth(Math.max(MaxHealth, Health - WholeDecay));
				State.DecayAccumulator -= WholeDecay;
			}
		}
		else
		{
			State.DecayAccumulator = 0;
		}
	});
}

function UpdateUberGlows(UberedPawns: ReadonlySet<CSPlayerPawn>): void
{
	for (const Pawn of GGlowingPawns)
	{
		if (!UberedPawns.has(Pawn) && Pawn.IsValid())
		{
			Pawn.Unglow();
		}
	}
	for (const Pawn of UberedPawns)
	{
		if (!GGlowingPawns.has(Pawn))
		{
			Pawn.Glow(GetTeamColor(Pawn));
		}
	}
	GGlowingPawns = new Set<CSPlayerPawn>(UberedPawns);
}

// Bots ////////////////////////////////////////////////////////////////////////////////////////////

function TickBots(Now: number): void
{
	const FreeMarkers: Map<Entity, EBotMode> = FindFreeBotMarkers();

	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (!Controller || !Controller.IsBot())
		{
			return;
		}

		const ReadyAt: number | undefined = GBotReadyAt.get(Slot);
		if (ReadyAt !== undefined && Now < ReadyAt)
		{
			return;
		}

		let Assignment: FBotAssignment | undefined = GBotAssignments.get(Slot);
		if (!Assignment)
		{
			Assignment = ClaimBotMarker(Slot, FreeMarkers);
			if (!Assignment)
			{
				return;
			}
		}
		if (!Assignment.bPlaced)
		{
			PlaceBotOnMarker(Pawn, Assignment);
		}
		DriveBot(Pawn, Assignment);
	});
}

function FindFreeBotMarkers(): Map<Entity, EBotMode>
{
	const Claimed: Set<Entity> = new Set<Entity>();
	for (const Assignment of GBotAssignments.values())
	{
		Claimed.add(Assignment.Marker);
	}

	const FreeMarkers: Map<Entity, EBotMode> = new Map<Entity, EBotMode>();
	for (const [MarkerName, Mode] of BotMarkerModes)
	{
		for (const Marker of Instance.FindEntitiesByName(MarkerName))
		{
			if (Marker.IsValid() && !Claimed.has(Marker))
			{
				FreeMarkers.set(Marker, Mode);
			}
		}
	}
	return FreeMarkers;
}

function ClaimBotMarker(Slot: number, FreeMarkers: Map<Entity, EBotMode>): FBotAssignment | undefined
{
	for (const [Marker, Mode] of FreeMarkers)
	{
		FreeMarkers.delete(Marker);
		const Assignment: FBotAssignment = { Marker: Marker, Mode: Mode, Yaw: 0, bPlaced: false };
		GBotAssignments.set(Slot, Assignment);
		return Assignment;
	}
	return undefined;
}

function PlaceBotOnMarker(Pawn: CSPlayerPawn, Assignment: FBotAssignment): void
{
	if (!Assignment.Marker.IsValid())
	{
		return;
	}
	Assignment.Yaw = Assignment.Marker.GetAbsAngles().yaw;
	Assignment.bPlaced = true;
	Pawn.Teleport({ position: Assignment.Marker.GetAbsOrigin(), angles: { pitch: 0, yaw: Assignment.Yaw, roll: 0 }, velocity: ZeroVector });
	Pawn.SetEyeAngles({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
	Pawn.SetHealth(1000);
}

function DriveBot(Pawn: CSPlayerPawn, Assignment: FBotAssignment): void
{
	if (Assignment.Mode === EBotMode.Still || !Pawn.GetGroundEntity())
	{
		return;
	}

	if (Assignment.Mode === EBotMode.Jump)
	{
		Pawn.Teleport({ velocity: { x: 0, y: 0, z: BotJumpSpeed } });
		return;
	}

	if (IsBotPathBlocked(Pawn, Assignment.Yaw))
	{
		Assignment.Yaw = (Assignment.Yaw + 180) % 360;
		Pawn.Teleport({ angles: { pitch: 0, yaw: Assignment.Yaw, roll: 0 } });
		Pawn.SetEyeAngles({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
	}
	const Forward: FVector = FVectorMath.GetForwardVector({ pitch: 0, yaw: Assignment.Yaw, roll: 0 });
	Pawn.Teleport({ velocity: { x: Forward.x * BotRunSpeed, y: Forward.y * BotRunSpeed, z: Pawn.GetAbsVelocity().z } });
}

function IsBotPathBlocked(Pawn: CSPlayerPawn, Yaw: number): boolean
{
	const Forward: FVector = FVectorMath.GetForwardVector({ pitch: 0, yaw: Yaw, roll: 0 });
	const Knee: FVector = FVectorMath.Add(Pawn.GetAbsOrigin(), { x: 0, y: 0, z: 24 });
	const Ahead: FVector = FVectorMath.Add(Knee, FVectorMath.Scale(Forward, BotTurnCheckDistance));

	const Wall: TraceResult = Instance.TraceLine({ start: Knee, end: Ahead, ignorePlayers: true });
	if (Wall.didHit)
	{
		return true;
	}

	const Floor: TraceResult = Instance.TraceLine(
	{
		start: Ahead,
		end: FVectorMath.Add(Ahead, { x: 0, y: 0, z: -(24 + BotLedgeCheckDepth) }),
		ignorePlayers: true,
	});
	return !Floor.didHit;
}

function ResetBotMode(Slot: number): void
{
	const Assignment: FBotAssignment | undefined = GBotAssignments.get(Slot);
	if (Assignment)
	{
		Assignment.bPlaced = false;
	}
	GBotReadyAt.set(Slot, Instance.GetGameTime() + BotSpawnSettleTime);
}

function ReleaseBotMarker(Slot: number): void
{
	GBotAssignments.delete(Slot);
}

// Decals //////////////////////////////////////////////////////////////////////////////////////////

function SpawnScorchMark(Position: FVector): void
{
	const Surface: TraceResult | undefined = FindNearbySurface(Position, ScorchSearchDistance);
	if (Surface)
	{
		SpawnDecal(ScorchTemplateName, Surface.end, Surface.normal);
	}
}

function SpawnBloodSplatter(ExplosionOrigin: FVector, Victim: CSPlayerPawn): void
{
	const Chest: FVector = GetChestPosition(Victim);
	const Away: FVector = FVectorMath.GetSafeNormal(FVectorMath.Subtract(Chest, ExplosionOrigin));
	const Behind: TraceResult = Instance.TraceLine(
	{
		start: Chest,
		end: FVectorMath.Add(Chest, FVectorMath.Scale(Away, BloodSplatterDistance)),
		ignorePlayers: true,
	});
	if (Behind.didHit && !Behind.startedInSolid)
	{
		SpawnDecal(BloodTemplateName, Behind.end, Behind.normal);
		return;
	}

	const Below: TraceResult = Instance.TraceLine(
	{
		start: Chest,
		end: FVectorMath.Add(Chest, FVectorMath.Scale(UpVector, -BloodSplatterDistance)),
		ignorePlayers: true,
	});
	if (Below.didHit && !Below.startedInSolid)
	{
		SpawnDecal(BloodTemplateName, Below.end, Below.normal);
	}
}

function SpawnDecal(TemplateName: string, Position: FVector, SurfaceNormal: FVector): void
{
	const Template: Entity | undefined = Instance.FindEntityByName(TemplateName);
	if (!IsPointTemplate(Template))
	{
		return;
	}

	const Rotation: FRotator = FVectorMath.GetRotation(FVectorMath.Scale(SurfaceNormal, -1), Math.random() * 360);
	const Spawned: Entity[] | undefined = Template.ForceSpawn(Position, Rotation);
	if (!Spawned || Spawned.length === 0)
	{
		return;
	}

	GDecals.push(Spawned);
	while (GDecals.length > MaxDecals)
	{
		const Oldest: Entity[] | undefined = GDecals.shift();
		if (Oldest)
		{
			RemoveEntities(Oldest);
		}
	}
}

function ClearDecals(): void
{
	for (const Decal of GDecals)
	{
		RemoveEntities(Decal);
	}
	GDecals = [];
}

function FindNearbySurface(Position: FVector, MaxDistance: number): TraceResult | undefined
{
	const Directions: readonly FVector[] =
	[
		{ x: 0, y: 0, z: -1 },
		{ x: 0, y: 0, z: 1 },
		{ x: 1, y: 0, z: 0 },
		{ x: -1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: -1, z: 0 },
	];

	let Closest: TraceResult | undefined = undefined;
	for (const Direction of Directions)
	{
		const Trace: TraceResult = Instance.TraceLine(
		{
			start: Position,
			end: FVectorMath.Add(Position, FVectorMath.Scale(Direction, MaxDistance)),
			ignorePlayers: true,
		});
		if (Trace.didHit && !Trace.startedInSolid && (!Closest || Trace.fraction < Closest.fraction))
		{
			Closest = Trace;
		}
	}
	return Closest;
}

function RemoveEntities(Entities: readonly Entity[]): void
{
	for (const Ent of Entities)
	{
		if (Ent.IsValid())
		{
			Ent.Remove();
		}
	}
}

// Hud /////////////////////////////////////////////////////////////////////////////////////////////

function ShowDamageNumber(Slot: number, Damage: number): void
{
	const Hud: CustomHudLayout | undefined = FindDamageHud();
	if (!Hud || Damage <= 0)
	{
		return;
	}

	const State: FPlayerState = GetPlayerState(Slot);
	const Now: number = Instance.GetGameTime();
	if (Now - State.LastDamageTime > DamageBatchWindow)
	{
		State.DamageTotal = 0;
	}
	State.DamageTotal += Damage;
	State.LastDamageTime = Now;

	State.bDamagePopA = !State.bDamagePopA;
	Hud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", `-${Math.round(State.DamageTotal)}`);

	SetTimer(DamageShowTime, (): void =>
	{
		const LaterHud: CustomHudLayout | undefined = FindDamageHud();
		if (LaterHud && Instance.GetGameTime() - State.LastDamageTime >= DamageShowTime - 0.01)
		{
			LaterHud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", "");
		}
	});
}

function ResetDamageNumbers(Slot: number): void
{
	const Hud: CustomHudLayout | undefined = FindDamageHud();
	if (Hud)
	{
		Hud.ResetForPlayer(Slot);
	}
}

function FindDamageHud(): CustomHudLayout | undefined
{
	const Hud: Entity | undefined = Instance.FindEntityByName(DamageHudName);
	if (IsCustomHudLayout(Hud))
	{
		return Hud;
	}
	if (!GbWarnedNoDamageHud)
	{
		GbWarnedNoDamageHud = true;
		const Problem: string = Hud ? "exists but isn't a custom_hud_layout" : "wasn't found";
		Instance.Msg(`${LogPrefix} damage numbers: an entity named "${DamageHudName}" ${Problem}. Check the custom_hud_layout in Hammer, then do a full map build.`);
	}
	return undefined;
}

// Util ///////////////////////////////////////////////////////////////////////////////////////////

abstract class FVectorMath
{
	public static Add(A: FVector, B: FVector): FVector
	{
		return { x: A.x + B.x, y: A.y + B.y, z: A.z + B.z };
	}

	public static Subtract(A: FVector, B: FVector): FVector
	{
		return { x: A.x - B.x, y: A.y - B.y, z: A.z - B.z };
	}

	public static Scale(V: FVector, Scalar: number): FVector
	{
		return { x: V.x * Scalar, y: V.y * Scalar, z: V.z * Scalar };
	}

	public static Size(V: FVector): number
	{
		return Math.hypot(V.x, V.y, V.z);
	}

	public static GetSafeNormal(V: FVector): FVector
	{
		const Length: number = Math.hypot(V.x, V.y, V.z) || 1;
		return { x: V.x / Length, y: V.y / Length, z: V.z / Length };
	}

	public static GetForwardVector(Rotation: FRotator): FVector
	{
		const Pitch: number = (Rotation.pitch * Math.PI) / 180;
		const Yaw: number = (Rotation.yaw * Math.PI) / 180;
		return { x: Math.cos(Pitch) * Math.cos(Yaw), y: Math.cos(Pitch) * Math.sin(Yaw), z: -Math.sin(Pitch) };
	}

	// The rotation whose forward vector points along Direction (the inverse of GetForwardVector)
	public static GetRotation(Direction: FVector, Roll: number = 0): FRotator
	{
		const Normal: FVector = FVectorMath.GetSafeNormal(Direction);
		const Pitch: number = (-Math.asin(Math.max(-1, Math.min(1, Normal.z))) * 180) / Math.PI;
		const Yaw: number = (Math.atan2(Normal.y, Normal.x) * 180) / Math.PI;
		return { pitch: Pitch, yaw: Yaw, roll: Roll };
	}
}

function IsValid<TEntity extends Entity>(Ent: TEntity | undefined): Ent is TEntity
{
	return Ent !== undefined && Ent.IsValid();
}

function IsPlayerPawn(Ent: Entity | undefined): Ent is CSPlayerPawn
{
	return Ent !== undefined
		&& "GetPlayerController" in Ent && typeof Ent.GetPlayerController === "function"
		&& "IsInputPressed" in Ent && typeof Ent.IsInputPressed === "function";
}

function IsCustomHudLayout(Ent: Entity | undefined): Ent is CustomHudLayout
{
	return Ent !== undefined && "SetDialogVariableStringForPlayer" in Ent && typeof Ent.SetDialogVariableStringForPlayer === "function";
}

function IsPointTemplate(Ent: Entity | undefined): Ent is PointTemplate
{
	return Ent !== undefined && "ForceSpawn" in Ent && typeof Ent.ForceSpawn === "function";
}

function GetChestPosition(Pawn: CSPlayerPawn): FVector
{
	return FVectorMath.Add(Pawn.GetAbsOrigin(), ChestOffset);
}

export function GetTeamColor(Ent: Entity): FColor
{
	return Ent.GetTeamNumber() === ETeam.Terrorist ? TerroristColor : CounterTerroristColor;
}

function GetPlayerSlot(Ent: Entity | undefined): number
{
	if (!IsPlayerPawn(Ent))
	{
		return INDEX_NONE;
	}
	const Controller: CSPlayerController | undefined = Ent.GetPlayerController();
	return Controller ? Controller.GetPlayerSlot() : INDEX_NONE;
}

export function IsWeapon(Weapon: CSWeaponBase | undefined, Name: string): boolean
{
	if (!Weapon)
	{
		return false;
	}
	if (Weapon.GetClassName() === Name)
	{
		return true;
	}
	const Data: CSWeaponData | undefined = Weapon.GetData();
	return Data !== undefined && Data.GetName() === Name;
}

function SpawnFromTemplate(TemplateName: string, Position: FVector): Entity | undefined
{
	const Template: Entity | undefined = Instance.FindEntityByName(TemplateName);
	if (!IsPointTemplate(Template))
	{
		return undefined;
	}
	const Spawned: Entity[] | undefined = Template.ForceSpawn(Position);
	return Spawned ? Spawned[0] : undefined;
}

function SetTimer(Delay: number, Callback: () => void): void
{
	GPendingTimers.push({ FireTime: Instance.GetGameTime() + Delay, Callback });
}

function ForEachLivePawn(Visitor: (Pawn: CSPlayerPawn, Slot: number) => void): void
{
	for (let Slot: number = 0; Slot < MaxPlayerSlots; Slot++)
	{
		const Controller: CSPlayerController | undefined = Instance.GetPlayerController(Slot);
		if (!Controller)
		{
			continue;
		}
		const Pawn: CSPlayerPawn | undefined = Controller.GetPlayerPawn();
		if (IsValid(Pawn) && Pawn.IsAlive())
		{
			Visitor(Pawn, Slot);
		}
	}
}