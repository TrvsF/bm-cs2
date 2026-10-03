import { Instance, CSInputs, CSDamageTypes, CSWeaponType, CSGearSlot } from "cs_script/point_script";
import type
{
	Entity,
	CSPlayerPawn,
	CSPlayerController,
	CSWeaponBase,
	CSWeaponData,
	PointTemplate,
	TraceResult,
	Vector,
	QAngle,
	ColorArg,
} from "cs_script/point_script";

const bDebug: boolean = true;
const TickInterval: number = 1 / 64;
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
type FModifyDamageEvent = TEventOf<typeof Instance.OnModifyPlayerDamage>;
type FModifyDamageResult = ReturnType<Parameters<typeof Instance.OnModifyPlayerDamage>[0]>;

enum EPlayerClass
{
	None = "none",
	Demoman = "demo",
	Solider = "soldier",
	Medic = "medic",
}

type EPlayableClass = Exclude<EPlayerClass, EPlayerClass.None>;

enum ETeam
{
	Unassigned = 0,
	Spectator = 1,
	Terrorist = 2,
	CounterTerrorist = 3,
}

interface FClassSettings
{
	readonly Primary: string;
	readonly Secondary: string;
	readonly Health: number;
	readonly SizeScale: number;
}

interface FSoliderSettings extends FClassSettings
{
	readonly RocketSpeed: number;
	readonly RocketDamage: number;
	readonly RocketRadius: number;
}

interface FDemoSettings extends FClassSettings
{
	readonly DetonateKey: CSInputs;
	readonly MaxStickies: number;
	readonly ArmTime: number;
	readonly LaunchSpeed: number;
	readonly LaunchUp: number;
	readonly Radius: number;
	readonly Damage: number;
	readonly Knockback: number;
}

interface FMedicSettings extends FClassSettings
{
	readonly Range: number;
	readonly BreakRange: number;
	readonly HealPerSec: number;
	readonly OverhealMult: number;
	readonly OverhealDecayPerSec: number;
	readonly UberSecondsToFill: number;
	readonly UberDuration: number;
}

interface FStickyBomb
{
	Owner: CSPlayerPawn;
	Position: FVector;
	Velocity: FVector;
	bStuck: boolean;
	ArmedAt: number;
	SpawnedAt: number;
	Model: Entity | undefined;
}

interface FPlayerState
{
	Stickies: FStickyBomb[];
	bDetonateHeld: boolean;
	HealTarget: CSPlayerPawn | undefined;
	HealAccumulator: number;
	DecayAccumulator: number;
	UberCharge: number;
	UberEndTime: number;
}

interface FPendingTimer
{
	FireTime: number;
	Callback: () => void;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const SoldierSettings: FSoliderSettings =
{
	Primary: "weapon_nova",
	Secondary: "",
	Health: 150,
	SizeScale: 1.25,
	RocketDamage: 100,
	RocketRadius: 160,
	RocketSpeed: 1200,
}

const DemoSettings: FDemoSettings =
{
	Primary: "weapon_nova",
	Secondary: "",
	Health: 130,
	SizeScale: 1.0,

	DetonateKey: CSInputs.ATTACK2,
	MaxStickies: 8,                   
	ArmTime: 0.8,
	LaunchSpeed: 900,
	LaunchUp: 150,                    
	Radius: 160,
	Damage: 100,
	Knockback: 450,
};

const MedicSettings: FMedicSettings =
{
	Primary: "weapon_mp7",
	Secondary: "",
	Health: 150,
	SizeScale: 0.9,    
	
	Range: 450,                       
	BreakRange: 540,                  
	HealPerSec: 24,
	OverhealMult: 1.5,
	OverhealDecayPerSec: 3.3,
	UberSecondsToFill: 40,
	UberDuration: 8,
};

const INDEX_NONE: number = -1;
const MaxPlayerSlots: number = 64;
const LogPrefix: string = "[BM]";
const StickyTemplateName: string = "sticky_template";
const ExplosionTemplateName: string = "boom_template";

const UpVector: FVector = { x: 0, y: 0, z: 1 };
const ChestOffset: FVector = { x: 0, y: 0, z: 40 };
const StickyLaunchOffset: FVector = { x: 0, y: 0, z: -8 };
const ExplosionOffset: FVector = { x: 0, y: 0, z: 6 };
const GroundedKnockbackLift: FVector = { x: 0, y: 0, z: 0.6 };
const BeamStartDrop: FVector = { x: 0, y: 0, z: 12 };

const TerroristColor: FColor = { r: 220, g: 60, b: 50 };
const CounterTerroristColor: FColor = { r: 70, g: 130, b: 230 };
const UnarmedStickyColor: FColor = { r: 120, g: 120, b: 120 };
const ExplosionDebugColor: FColor = { r: 255, g: 140, b: 0 };
const UberReadyColor: FColor = { r: 255, g: 255, b: 255 };

const StrippedGearSlots: readonly CSGearSlot[] = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.GRENADES];

const ClassChatCommands: ReadonlyMap<string, EPlayerClass> = new Map<string, EPlayerClass>(
	[
		["!demo", EPlayerClass.Demoman],
		["!medic", EPlayerClass.Medic],
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
	Instance.SetNextThink(Now + TickInterval); // schedule first so an error can't stop the loop
	const DeltaTime: number = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
	GLastThinkTime = Now;

	try
	{
		TickMatch(Now);
		TickTimers(Now);

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
	Instance.OnModifyPlayerDamage(HandleModifyPlayerDamage);

	Instance.SetThink(Tick);
	Instance.SetNextThink(Instance.GetGameTime());
	Instance.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}. Type !demo or !medic in chat.`);
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

	// A Map lookup, so only these exact commands match
	const Command: string = Event.text.trim().toLowerCase();
	const PlayerClass: EPlayerClass | undefined = ClassChatCommands.get(Command);
	if (PlayerClass === undefined)
	{
		return;
	}

	const Slot: number = Player.GetPlayerSlot();
	ClearPlayer(Slot);

	if (PlayerClass === EPlayerClass.None)
	{
		GClassBySlot.delete(Slot);
	}
	else
	{
		GClassBySlot.set(Slot, PlayerClass);
		const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
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
		ClearPlayer(Slot); // stickies vanish and über resets on death, like TF2
	}
}

function HandlePlayerDisconnect(Event: FPlayerDisconnectEvent): void
{
	ClearPlayer(Event.playerSlot);
	GClassBySlot.delete(Event.playerSlot);
	GPlayerStates.delete(Event.playerSlot);
}

function HandleRoundStart(): void
{
	for (const Slot of GPlayerStates.keys())
	{
		ClearPlayer(Slot);
	}
	ApplyMatchSettings();
	Instance.Msg(`${LogPrefix} match settings applied`);
}

function HandleGunFire(Event: FGunFireEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	const Pawn: CSPlayerPawn | undefined = Weapon.GetOwner();
	const Slot: number = GetPlayerSlot(Pawn);
	if (!Pawn || Slot === INDEX_NONE || GClassBySlot.get(Slot) !== EPlayerClass.Demoman || !IsWeapon(Weapon, DemoSettings.Primary))
	{
		return;
	}

	const Now: number = Instance.GetGameTime();
	const Direction: FVector = FVectorMath.GetForwardVector(Pawn.GetEyeAngles());
	const Start: FVector = FVectorMath.Add(Pawn.GetEyePosition(), StickyLaunchOffset);
	const LaunchVelocity: FVector = FVectorMath.Add(FVectorMath.Scale(Direction, DemoSettings.LaunchSpeed), { x: 0, y: 0, z: DemoSettings.LaunchUp });

	const Sticky: FStickyBomb =
	{
		Owner: Pawn,
		Position: Start,
		Velocity: LaunchVelocity,
		bStuck: false,
		ArmedAt: Now + DemoSettings.ArmTime,
		SpawnedAt: Now,
		Model: SpawnFromTemplate(StickyTemplateName, Start),
	};

	const State: FPlayerState = GetPlayerState(Slot);
	State.Stickies.push(Sticky);
	if (!bDebug)
	{
		while (State.Stickies.length > DemoSettings.MaxStickies)
		{
			const Oldest: FStickyBomb | undefined = State.Stickies.shift(); // oldest fizzles
			if (Oldest)
			{
				DestroySticky(Oldest);
			}
		}
	}
}

function HandleModifyPlayerDamage(Event: FModifyDamageEvent): FModifyDamageResult
{
	if (GUberedPawns.has(Event.player))
	{
		return { abort: true };
	}

	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	if (AttackerSlot === INDEX_NONE)
	{
		return;
	}
	const AttackerClass: EPlayableClass | undefined = GClassBySlot.get(AttackerSlot);
	const bIsBlast: boolean = (Event.damageTypes & CSDamageTypes.BLAST) !== 0;

	if (AttackerClass === EPlayerClass.Demoman && !bIsBlast && IsWeapon(Event.weapon, DemoSettings.Primary))
	{
		return { abort: true };
	}

	if (AttackerClass === EPlayerClass.Medic && Event.weapon && Event.weapon.GetData().GetType() === CSWeaponType.KNIFE)
	{
		return { abort: true };
	}
	return;
}

// Globals ////////////////////////////////////////////////////////////////////////////////////////

const GClassBySlot: Map<number, EPlayableClass> = new Map<number, EPlayableClass>();
const GPlayerStates: Map<number, FPlayerState> = new Map<number, FPlayerState>();
const GPendingTimers: FPendingTimer[] = [];
let GUberedPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
let GGlowingPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
let GLastThinkTime: number = 0;

function GetPlayerState(Slot: number): FPlayerState
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

// Class //////////////////////////////////////////////////////////////////////////////////////////

function StripGuns(Pawn: CSPlayerPawn): void
{
	for (const GearSlot of StrippedGearSlots)
	{
		for (let Attempt: number = 0; Attempt < 6; Attempt++)
		{
			const Weapon: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(GearSlot);
			if (!Weapon)
			{
				break;
			}
			Pawn.DestroyWeapon(Weapon);
		}
	}
}

function GiveLoadout(Pawn: CSPlayerPawn, PlayerClass: EPlayableClass): void
{
	StripGuns(Pawn);
	switch (PlayerClass)
	{
		case EPlayerClass.Demoman:
		{
			Pawn.GiveNamedItem(DemoSettings.Primary, true);
			break;
		}
		case EPlayerClass.Medic:
		{
			Pawn.GiveNamedItem(MedicSettings.Primary);
			const Knife: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
			if (Knife)
			{
				Pawn.SwitchToWeapon(Knife);
			}
			break;
		}
		case EPlayerClass.Solider:
		{
			break;
		}
		default:
		{
			const Unhandled: never = PlayerClass;
			Instance.Msg(`${LogPrefix} no loadout for class ${String(Unhandled)}`);
			break;
		}
	}
}

function DestroySticky(Sticky: FStickyBomb): void
{
	if (IsValid(Sticky.Model))
	{
		Sticky.Model.Remove();
	}
}

function ClearPlayer(Slot: number): void
{
	const State: FPlayerState | undefined = GPlayerStates.get(Slot);
	if (!State)
	{
		return;
	}
	for (const Sticky of State.Stickies)
	{
		DestroySticky(Sticky);
	}
	State.Stickies = [];
	State.HealTarget = undefined;
	State.UberCharge = 0;
	State.UberEndTime = 0;
}

// Demo //////////////////////////////////////////////////////////////////////////////////////////

function StepSticky(Sticky: FStickyBomb, DeltaTime: number, Now: number): boolean
{
	if (Sticky.bStuck)
	{
		return true;
	}

	Sticky.Velocity = { x: Sticky.Velocity.x, y: Sticky.Velocity.y, z: Sticky.Velocity.z - Gravity * DeltaTime };
	const NextPosition: FVector = FVectorMath.Add(Sticky.Position, FVectorMath.Scale(Sticky.Velocity, DeltaTime));
	const IgnoredEntities: Entity[] = IsValid(Sticky.Model) ? [Sticky.Owner, Sticky.Model] : [Sticky.Owner];
	const Trace: TraceResult = Instance.TraceLine(
	{
		start: Sticky.Position,
		end: NextPosition,
		ignoreEntity: IgnoredEntities,
		ignorePlayers: true,
	});

	if (Trace.didHit)
	{
		Sticky.Position = FVectorMath.Add(Trace.end, FVectorMath.Scale(Trace.normal, 2)); // sit just off the surface
		Sticky.bStuck = true;
	}
	else
	{
		Sticky.Position = NextPosition;
	}

	if (IsValid(Sticky.Model))
	{
		Sticky.Model.Teleport({ position: Sticky.Position });
	}
	return true;
}

function Explode(Position: FVector, Attacker: CSPlayerPawn): void
{
	const Origin: FVector = FVectorMath.Add(Position, ExplosionOffset);

	if (!SpawnFromTemplate(ExplosionTemplateName, Origin))
	{
		Instance.DebugSphere({ center: Origin, radius: DemoSettings.Radius, duration: 0.3, color: ExplosionDebugColor });
	}
	if (!Attacker.IsValid())
	{
		return;
	}

	ForEachLivePawn((Victim: CSPlayerPawn): void =>
	{
		const Target: FVector = GetChestPosition(Victim);
		const Offset: FVector = FVectorMath.Subtract(Target, Origin);
		const Distance: number = FVectorMath.Size(Offset);
		if (Distance > DemoSettings.Radius)
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

		const Falloff: number = 1 - 0.5 * (Distance / DemoSettings.Radius);
		let CalculatedDmg: number = DemoSettings.Damage * Falloff;
		if (bIsSelf)
		{
			CalculatedDmg *= 0.33;	
		}

		// do knockback 
        const IsCrouched: boolean = Victim.IsDucking() || Victim.IsDucked();
        let Direction: FVector = Distance > 1 ? FVectorMath.GetSafeNormal(Offset) : UpVector;
        if (Victim.GetGroundEntity())
        {
            Direction = FVectorMath.GetSafeNormal(FVectorMath.Add(Direction, GroundedKnockbackLift));
        }

        const CrouchFactor: number = IsCrouched ? 62 : 82;
        let KBStrength: number = DemoSettings.Knockback;
        if (!Victim.GetGroundEntity() && bIsSelf)
        {
            KBStrength *= 1.33;
        }

        const CalculatedKb: number = CalculatedDmg * (KBStrength / CrouchFactor);
        Victim.Teleport({ velocity: FVectorMath.Add(Victim.GetAbsVelocity(), FVectorMath.Scale(Direction, CalculatedKb)) });
		
		Victim.TakeDamage(
		{
			damage: CalculatedDmg,
			damageTypes: CSDamageTypes.BLAST,
			attacker: Attacker,
			inflictor: Attacker,
		});

		Instance.Msg(`${LogPrefix} Damaged ${Victim.GetPlayerController()?.GetPlayerName()} : ${CalculatedDmg}d : ${CalculatedKb}k (${Direction.x}, ${Direction.y}, ${Direction.z}) : ${Falloff}f`);
	});
}

function TickDemoman(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
{
	const State: FPlayerState = GetPlayerState(Slot);
	State.Stickies = State.Stickies.filter((Sticky: FStickyBomb): boolean =>
	{
		const bKeep: boolean = StepSticky(Sticky, DeltaTime, Now);
		if (!bKeep)
		{
			DestroySticky(Sticky);
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
		DestroySticky(Sticky);
		Explode(Sticky.Position, Pawn);
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

function IsPointTemplate(Ent: Entity | undefined): Ent is PointTemplate
{
	return Ent !== undefined && "ForceSpawn" in Ent && typeof Ent.ForceSpawn === "function";
}

function GetChestPosition(Pawn: CSPlayerPawn): FVector
{
	return FVectorMath.Add(Pawn.GetAbsOrigin(), ChestOffset);
}

function GetTeamColor(Ent: Entity): FColor
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

function IsWeapon(Weapon: CSWeaponBase | undefined, Name: string): boolean
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
