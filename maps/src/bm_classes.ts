import { Instance, CSInputs, CSGearSlot, CSDamageTypes, CSWeaponType } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CSWeaponBase, CSWeaponData } from "cs_script/point_script";
import { bDebug, TickInterval, FVectorMath, GetTeamColor, GetChestPosition, GetPlayerSlot, IsPlayerPawn, IsWeapon, ForEachLivePawn } from "./bm_core";
import type { FVector, FColor, FModifyDamageEvent, FModifyDamageResult } from "./bm_core";
import { LaunchProjectile, MoveProjectile, DestroyProjectile, Explode, ApplyBulletFalloff } from "./bm_combat";
import type { FProjectile, FDamageFalloff } from "./bm_combat";
import { EquipLauncher } from "./bm_launcher";
import type { FLauncherSettings } from "./bm_launcher";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export enum EPlayerClass
{
	None = "none",
	Demoman = "demo",
	Solider = "soldier",
	Medic = "medic",
	Railer = "railer",
}

export type EPlayableClass = Exclude<EPlayerClass, EPlayerClass.None>;

export interface FClassSettings
{
	readonly DisplayName: string;
	readonly Primary: string;
	readonly Secondary: string;
	readonly Melee: string;
	readonly Health: number;
	readonly SizeScale: number;
	readonly PrimaryLauncher: FLauncherSettings | undefined;
	readonly SecondaryLauncher: FLauncherSettings | undefined;
}

export interface FHitscanSettings
{
	readonly BulletFalloff: FDamageFalloff | undefined;
}

export interface FSoliderSettings extends FClassSettings
{
	readonly RocketSpeed: number;
	readonly RocketDamage: number;
	readonly RocketRadius: number;
	readonly RocketKnockback: number;
	readonly RocketLifetime: number;
	readonly RocketFalloff: FDamageFalloff | undefined;
}

export interface FDemoSettings extends FClassSettings
{
	readonly PipeLaunchSpeed: number,
	readonly PipeLaunchUp: number,
	readonly PipeRadius: number,
	readonly PipeDamage: number,
	readonly PipeKnockback: number,
	readonly PipeFalloff: FDamageFalloff | undefined,
	readonly PipeLifetime: number,
	readonly StickyDetonateKey: CSInputs;
	readonly StickyMax: number;
	readonly StickyArmTime: number;
	readonly StickyLaunchSpeed: number;
	readonly StickyLaunchUp: number;
	readonly StickyRadius: number;
	readonly StickyDamage: number;
	readonly StickyKnockback: number;
	readonly StickyFalloff: FDamageFalloff | undefined;
	readonly StickyFalloffTime: number;
}

export interface FMedicSettings extends FClassSettings, FHitscanSettings
{
	readonly Range: number;
	readonly BreakRange: number;
	readonly HealPerSec: number;
	readonly OverhealMult: number;
	readonly OverhealDecayPerSec: number;
	readonly UberSecondsToFill: number;
	readonly UberDuration: number;
}

export interface FRailerSettings extends FClassSettings
{
	readonly BeamChargeTime: number;
}

export interface FRocket extends FProjectile
{
}

export interface FPipe extends FProjectile
{
}

export interface FStickyBomb extends FProjectile
{
	bStuck: boolean;
	ArmedAt: number;
}

interface FDemoPlayerState
{
	Stickies: FStickyBomb[];
	bDetonateHeld: boolean;
}

interface FMedicPlayerState
{
	HealTarget: CSPlayerPawn | undefined;
	HealAccumulator: number;
	UberCharge: number;
	UberEndTime: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const TF2HitscanFalloff: FDamageFalloff = { RampUp: 1.5, FallOff: 0.5, OptimalDistance: 512 };
const TF2RocketFalloff: FDamageFalloff = { RampUp: 1.25, FallOff: 0.5, OptimalDistance: 512 };
const TF2StickyFalloff: FDamageFalloff = { RampUp: 1.1, FallOff: 0.9, OptimalDistance: 512 };

export const SoldierSettings: FSoliderSettings =
{
	DisplayName: "Soldier",
	Primary: "weapon_awp",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 150,
	SizeScale: 1.25,
	PrimaryLauncher:
	{
		FireInterval: 0.8,
		ClipSize: 4,
		ReloadFirstTime: 0.92,
		ReloadEachTime: 0.8,
		FireFxTemplate: "rocket_fire_template",
	},
	SecondaryLauncher: undefined,

	RocketDamage: 80,
	RocketRadius: 160,
	RocketSpeed: 1200,
	RocketKnockback: 400,
	RocketLifetime: 10,
	RocketFalloff: TF2RocketFalloff,
};

export const DemoSettings: FDemoSettings =
{
	DisplayName: "Demoman",
	Primary: "weapon_sawedoff",
	Secondary: "weapon_deagle",
	Melee: "",
	Health: 130,
	SizeScale: 1.0,
	PrimaryLauncher:
	{
		FireInterval: 0.6,
		ClipSize: 6,
		ReloadFirstTime: 1.09,
		ReloadEachTime: 0.67,
		FireFxTemplate: "sticky_fire_template",
	},
	SecondaryLauncher:
	{
		FireInterval: 0.6,
		ClipSize: 4,
		ReloadFirstTime: 1.24,
		ReloadEachTime: 0.6,
		FireFxTemplate: "pipe_fire_template",
	},
	
	StickyDetonateKey: CSInputs.ATTACK2,
	StickyMax: 6,
	StickyArmTime: 0.8,
	StickyLaunchSpeed: 900,
	StickyLaunchUp: 150,
	StickyRadius: 160,
	StickyDamage: 90,
	StickyKnockback: 600,
	StickyFalloff: TF2StickyFalloff,
	StickyFalloffTime: 5,
	PipeLaunchSpeed: 1337,
	PipeLaunchUp: 150,
	PipeRadius: 160,
	PipeDamage: 20,
	PipeKnockback: 1000,
	PipeFalloff: TF2RocketFalloff,
	PipeLifetime: 5,
};

export const MedicSettings: FMedicSettings =
{
	DisplayName: "Medic",
	Primary: "weapon_nova",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 150,
	SizeScale: 0.9,
	PrimaryLauncher: undefined,
	SecondaryLauncher: undefined,
	BulletFalloff: TF2HitscanFalloff,

	Range: 450,
	BreakRange: 540,
	HealPerSec: 24,
	OverhealMult: 1.5,
	OverhealDecayPerSec: 3.3,
	UberSecondsToFill: 40,
	UberDuration: 8,
};

export const RailerSettings: FRailerSettings =
{
	DisplayName: "Railer",
	Primary: "weapon_scar20",
	Secondary: "weapon_revolver",
	Melee: "",
	Health: 100,
	SizeScale: 0.8,
	PrimaryLauncher: undefined,
	SecondaryLauncher: undefined,
	
	BeamChargeTime: 1,
};

const StickyTemplateName: string = "sticky_template";
const RocketTemplateName: string = "rocket_template";
const PipeTemplateName: string = "pipe_template";
const DefaultHealth: number = 100;
const DefaultSizeScale: number = 1.0;
const StrippedGearSlots: readonly CSGearSlot[] = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE, CSGearSlot.GRENADES];
const NoClassStrippedGearSlots: readonly CSGearSlot[] = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.GRENADES];
const NoClassMelee: string = "weapon_knife";

const BeamStartDrop: FVector = { x: 0, y: 0, z: 12 };
const UnarmedStickyColor: FColor = { r: 240, g: 240, b: 240 };
const UberReadyColor: FColor = { r: 255, g: 255, b: 255 };

// Body ////////////////////////////////////////////////////////////////////////////////////////////

export function ApplyBody(Pawn: CSPlayerPawn, Health: number, SizeScale: number): void
{
	Pawn.SetMaxHealth(Health);
	Pawn.SetHealth(Health);
	Pawn.SetModelScale(SizeScale);
}

export function RestoreDefaultBody(Pawn: CSPlayerPawn): void
{
	ApplyBody(Pawn, DefaultHealth, DefaultSizeScale);
}

function StripGearSlots(Pawn: CSPlayerPawn, GearSlots: readonly CSGearSlot[]): void
{
	for (const GearSlot of GearSlots)
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

// Classes /////////////////////////////////////////////////////////////////////////////////////////

abstract class UPlayerClass<TSettings extends FClassSettings>
{
	public readonly Settings: TSettings;

	constructor(Settings: TSettings)
	{
		this.Settings = Settings;
	}

	public ApplyLoadout(Pawn: CSPlayerPawn): void
	{
		StripGearSlots(Pawn, StrippedGearSlots);
		ApplyBody(Pawn, this.Settings.Health, this.Settings.SizeScale);

		if (this.Settings.Melee !== "")
		{
			Pawn.GiveNamedItem(this.Settings.Melee);
		}

		const bHasSecondary: boolean = this.Settings.Secondary !== "" && this.Settings.Secondary !== this.Settings.Primary;
		if (bHasSecondary)
		{
			Pawn.GiveNamedItem(this.Settings.Secondary);
		}
		Pawn.GiveNamedItem(this.Settings.Primary, true);

		const Slot: number = GetPlayerSlot(Pawn);
		if (this.Settings.PrimaryLauncher)
		{
			EquipLauncher(Pawn, Slot, this.Settings.Primary, this.Settings.PrimaryLauncher);
		}
		if (bHasSecondary && this.Settings.SecondaryLauncher)
		{
			EquipLauncher(Pawn, Slot, this.Settings.Secondary, this.Settings.SecondaryLauncher);
		}

		this.OnLoadoutApplied(Pawn);
	}

	// Override for class-specific setup. Runs after the shared loadout.
	protected OnLoadoutApplied(Pawn: CSPlayerPawn): void
	{
	}

	// Called when someone playing this class fires their primary
	public OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
	}

	// Called when someone playing this class fires their secondary
	public OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
	}

	// Called every tick, whether or not anyone is playing this class
	public TickWorld(Now: number, DeltaTime: number): void
	{
	}

	// Called every tick for each living player of this class, after every class's TickWorld
	public TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
	}

	// Called every tick after every player has been ticked
	public TickWorldLate(Now: number, DeltaTime: number): void
	{
	}

	public OnRoundStart(): void
	{
	}

	// Called on every class when a player dies, respawns, switches class or leaves, so their leftovers get cleaned up
	public ClearPlayer(Slot: number): void
	{
	}

	// Override to change or block damage dealt by this class
	public ModifyOutgoingDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		if (this.IsPrimaryBulletDamage(Event) || this.IsSecondaryBulletDamage(Event))
		{
			return { abort: true };
		}
	}

	// Called for every damage event, whoever deals it (e.g. über protecting a patient)
	public ModifyAnyDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		return;
	}

	// True for the primary's own bullets, as opposed to explosions it causes
	protected IsPrimaryBulletDamage(Event: FModifyDamageEvent): boolean
	{
		const bIsBlast: boolean = (Event.damageTypes & CSDamageTypes.BLAST) !== 0;
		return !bIsBlast && IsWeapon(Event.weapon, this.Settings.Primary);
	}

	// True for the secondary's own bullets
	protected IsSecondaryBulletDamage(Event: FModifyDamageEvent): boolean
	{
		const bIsBlast: boolean = (Event.damageTypes & CSDamageTypes.BLAST) !== 0;
		return !bIsBlast && this.Settings.Secondary !== "" && IsWeapon(Event.weapon, this.Settings.Secondary);
	}
}

// Soldier /////////////////////////////////////////////////////////////////////////////////////////

class USoldierClass extends UPlayerClass<FSoliderSettings>
{
	private Rockets: FRocket[] = [];

	constructor()
	{
		super(SoldierSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Rocket: FRocket = LaunchProjectile(Pawn, this.Settings.RocketSpeed, 0, 0, RocketTemplateName);
		this.Rockets.push(Rocket);
	}

	public override TickWorld(Now: number, DeltaTime: number): void
	{
		this.Rockets = this.Rockets.filter((Rocket: FRocket): boolean =>
		{
			return this.StepRocket(Rocket, Now, DeltaTime);
		});
	}

	public override OnRoundStart(): void
	{
		for (const Rocket of this.Rockets)
		{
			DestroyProjectile(Rocket);
		}
		this.Rockets = [];
	}

	private StepRocket(Rocket: FRocket, Now: number, DeltaTime: number): boolean
	{
		if (!Rocket.Owner.IsValid() || Now - Rocket.SpawnedAt > this.Settings.RocketLifetime)
		{
			DestroyProjectile(Rocket);
			return false;
		}

		if (MoveProjectile(Rocket, DeltaTime, true))
		{
			DestroyProjectile(Rocket);
			Explode(Rocket.Position, Rocket.Owner, this.Settings.RocketRadius, this.Settings.RocketDamage, this.Settings.RocketKnockback, this.Settings.RocketFalloff);
			return false;
		}

		if (!Rocket.Model)
		{
			Instance.DebugSphere({ center: Rocket.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Rocket.Owner) });
		}
		return true;
	}
}

// Demoman /////////////////////////////////////////////////////////////////////////////////////////

class UDemomanClass extends UPlayerClass<FDemoSettings>
{
	private PlayerStates: Map<number, FDemoPlayerState> = new Map<number, FDemoPlayerState>();
	private Pipes: FPipe[] = [];

	constructor()
	{
		super(DemoSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Sticky: FStickyBomb =
		{
			...LaunchProjectile(Pawn, this.Settings.StickyLaunchSpeed, this.Settings.StickyLaunchUp, 1, StickyTemplateName),
			bStuck: false,
			ArmedAt: Now + this.Settings.StickyArmTime,
		};

		const State: FDemoPlayerState = this.GetPlayerState(Slot);
		State.Stickies.push(Sticky);
		if (!bDebug)
		{
			while (State.Stickies.length > this.Settings.StickyMax)
			{
				const Oldest: FStickyBomb | undefined = State.Stickies.shift();
				if (Oldest)
				{
					DestroyProjectile(Oldest);
				}
			}
		}
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Pipe: FPipe = LaunchProjectile(Pawn, this.Settings.PipeLaunchSpeed, this.Settings.PipeLaunchUp, 1, PipeTemplateName);
		this.Pipes.push(Pipe);
	}

	public override TickWorld(Now: number, DeltaTime: number): void
	{
		this.Pipes = this.Pipes.filter((Pipe: FPipe): boolean =>
		{
			return this.StepPipe(Pipe, Now, DeltaTime);
		});
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FDemoPlayerState = this.GetPlayerState(Slot);
		for (const Sticky of State.Stickies)
		{
			if (!Sticky.bStuck && MoveProjectile(Sticky, DeltaTime, false))
			{
				Sticky.bStuck = true;
			}
		}

		for (const Sticky of State.Stickies)
		{
			if (!Sticky.Model)
			{
				const Color: FColor = Now >= Sticky.ArmedAt ? GetTeamColor(Pawn) : UnarmedStickyColor;
				Instance.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: Color });
			}
		}

		const bDown: boolean = Pawn.IsInputPressed(this.Settings.StickyDetonateKey);
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
			const bYoungSticky: boolean = Now - Sticky.SpawnedAt < this.Settings.StickyFalloffTime;
			const RangeFalloff: FDamageFalloff | undefined = bYoungSticky ? this.Settings.StickyFalloff : undefined;
			Explode(Sticky.Position, Pawn, this.Settings.StickyRadius, this.Settings.StickyDamage, this.Settings.StickyKnockback, RangeFalloff);
		}
		State.Stickies = StillArming;
	}

	public override OnRoundStart(): void
	{
		for (const Slot of this.PlayerStates.keys())
		{
			this.ClearPlayer(Slot);
		}
		for (const Pipe of this.Pipes)
		{
			DestroyProjectile(Pipe);
		}
		this.Pipes = [];
	}

	public override ClearPlayer(Slot: number): void
	{
		const State: FDemoPlayerState | undefined = this.PlayerStates.get(Slot);
		if (!State)
		{
			return;
		}
		for (const Sticky of State.Stickies)
		{
			DestroyProjectile(Sticky);
		}
		this.PlayerStates.delete(Slot);
	}

	private GetPlayerState(Slot: number): FDemoPlayerState
	{
		let State: FDemoPlayerState | undefined = this.PlayerStates.get(Slot);
		if (!State)
		{
			State = { Stickies: [], bDetonateHeld: false };
			this.PlayerStates.set(Slot, State);
		}
		return State;
	}

	private StepPipe(Pipe: FPipe, Now: number, DeltaTime: number): boolean
	{
		if (!Pipe.Owner.IsValid() || Now - Pipe.SpawnedAt > this.Settings.PipeLifetime)
		{
			DestroyProjectile(Pipe);
			return false;
		}

		if (MoveProjectile(Pipe, DeltaTime, true))
		{
			DestroyProjectile(Pipe);
			Explode(Pipe.Position, Pipe.Owner, this.Settings.PipeRadius, this.Settings.PipeDamage, this.Settings.PipeKnockback, this.Settings.PipeFalloff);
			return false;
		}

		if (!Pipe.Model)
		{
			Instance.DebugSphere({ center: Pipe.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Pipe.Owner) });
		}
		return true;
	}
}

// Medic ///////////////////////////////////////////////////////////////////////////////////////////

class UMedicClass extends UPlayerClass<FMedicSettings>
{
	private PlayerStates: Map<number, FMedicPlayerState> = new Map<number, FMedicPlayerState>();
	private DecayAccumulators: Map<number, number> = new Map<number, number>();   // overheal decay, for any player
	private HealedThisTick: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private UberedThisTick: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private UberedPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private GlowingPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private HudLine: number = 0;

	constructor()
	{
		super(MedicSettings);
	}

	protected override OnLoadoutApplied(Pawn: CSPlayerPawn): void
	{
		const Knife: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
		if (Knife)
		{
			Pawn.SwitchToWeapon(Knife);
		}
	}

	public override TickWorld(Now: number, DeltaTime: number): void
	{
		this.HealedThisTick = new Set<CSPlayerPawn>();
		this.UberedThisTick = new Set<CSPlayerPawn>();
		this.HudLine = 0;
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FMedicPlayerState = this.GetPlayerState(Slot);
		const ActiveWeapon: CSWeaponBase | undefined = Pawn.GetActiveWeapon();
		const bHoldingMedigun: boolean = !!ActiveWeapon && ActiveWeapon.GetData().GetType() === CSWeaponType.KNIFE;
		const bFiring: boolean = bHoldingMedigun && Pawn.IsInputPressed(CSInputs.ATTACK);

		let Target: CSPlayerPawn | undefined = bFiring ? State.HealTarget : undefined;
		if (Target && !this.IsHealTargetValid(Pawn, Target))
		{
			Target = undefined;
		}
		if (bFiring && !Target)
		{
			Target = this.AcquireHealTarget(Pawn);
		}
		State.HealTarget = Target;

		if (Target)
		{
			this.HealedThisTick.add(Target);
			const MaxHealth: number = Target.GetMaxHealth();
			const OverhealCap: number = Math.floor(MaxHealth * this.Settings.OverhealMult);
			const Health: number = Target.GetHealth();
			if (Health < OverhealCap)
			{
				State.HealAccumulator += this.Settings.HealPerSec * DeltaTime;
				const WholeHealth: number = Math.floor(State.HealAccumulator);
				if (WholeHealth > 0)
				{
					Target.SetHealth(Math.min(OverhealCap, Health + WholeHealth));
					State.HealAccumulator -= WholeHealth;
				}
			}
			if (Now >= State.UberEndTime)
			{
				const ChargeRate: number = (100 / this.Settings.UberSecondsToFill) * (Health < MaxHealth ? 1 : 0.5); // slower on topped-up patients
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
			State.UberEndTime = Now + this.Settings.UberDuration;
		}

		const bUberActive: boolean = Now < State.UberEndTime;
		if (bUberActive)
		{
			State.UberCharge = (100 * (State.UberEndTime - Now)) / this.Settings.UberDuration;
			this.UberedThisTick.add(Pawn);
			if (Target)
			{
				this.UberedThisTick.add(Target);
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
			y: 220 + this.HudLine * 18,
			duration: TickInterval * 2,
			color: State.UberCharge >= 100 ? UberReadyColor : GetTeamColor(Pawn),
		});
		this.HudLine++;
	}

	public override TickWorldLate(Now: number, DeltaTime: number): void
	{
		this.TickOverhealDecay(DeltaTime);
		this.UpdateUberGlows();
		this.UberedPawns = this.UberedThisTick;
	}

	public override OnRoundStart(): void
	{
		this.PlayerStates.clear();
	}

	public override ClearPlayer(Slot: number): void
	{
		this.PlayerStates.delete(Slot);
		this.DecayAccumulators.delete(Slot);
	}

	public override ModifyOutgoingDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		if (Event.weapon && Event.weapon.GetData().GetType() === CSWeaponType.KNIFE)
		{
			return { abort: true };
		}
		return ApplyBulletFalloff(Event, this.Settings.BulletFalloff);
	}

	public override ModifyAnyDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		if (this.UberedPawns.has(Event.player))
		{
			return { abort: true };
		}
		return;
	}

	private GetPlayerState(Slot: number): FMedicPlayerState
	{
		let State: FMedicPlayerState | undefined = this.PlayerStates.get(Slot);
		if (!State)
		{
			State = { HealTarget: undefined, HealAccumulator: 0, UberCharge: 0, UberEndTime: 0 };
			this.PlayerStates.set(Slot, State);
		}
		return State;
	}

	private IsHealTargetValid(Medic: CSPlayerPawn, Target: CSPlayerPawn): boolean
	{
		if (!Target.IsValid() || !Target.IsAlive() || Target.GetTeamNumber() !== Medic.GetTeamNumber())
		{
			return false;
		}
		const EyePosition: FVector = Medic.GetEyePosition();
		const TargetChest: FVector = GetChestPosition(Target);
		if (FVectorMath.Size(FVectorMath.Subtract(TargetChest, EyePosition)) > this.Settings.BreakRange)
		{
			return false;
		}
		return !Instance.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
	}

	private AcquireHealTarget(Medic: CSPlayerPawn): CSPlayerPawn | undefined
	{
		const EyePosition: FVector = Medic.GetEyePosition();
		const Forward: FVector = FVectorMath.GetForwardVector(Medic.GetEyeAngles());
		const End: FVector = FVectorMath.Add(EyePosition, FVectorMath.Scale(Forward, this.Settings.Range));
		const HitEntity: Entity | undefined = Instance.TraceSphere({ start: EyePosition, end: End, radius: 12, ignoreEntity: Medic }).hitEntity;
		if (IsPlayerPawn(HitEntity) && HitEntity.IsAlive() && HitEntity.GetTeamNumber() === Medic.GetTeamNumber())
		{
			return HitEntity;
		}
		return undefined;
	}

	private TickOverhealDecay(DeltaTime: number): void
	{
		ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
		{
			const MaxHealth: number = Pawn.GetMaxHealth();
			const Health: number = Pawn.GetHealth();
			if (Health > MaxHealth && !this.HealedThisTick.has(Pawn))
			{
				let Accumulator: number = (this.DecayAccumulators.get(Slot) ?? 0) + this.Settings.OverhealDecayPerSec * DeltaTime;
				const WholeDecay: number = Math.floor(Accumulator);
				if (WholeDecay > 0)
				{
					Pawn.SetHealth(Math.max(MaxHealth, Health - WholeDecay));
					Accumulator -= WholeDecay;
				}
				this.DecayAccumulators.set(Slot, Accumulator);
			}
			else
			{
				this.DecayAccumulators.set(Slot, 0);
			}
		});
	}

	private UpdateUberGlows(): void
	{
		for (const Pawn of this.GlowingPawns)
		{
			if (!this.UberedThisTick.has(Pawn) && Pawn.IsValid())
			{
				Pawn.Unglow();
			}
		}
		for (const Pawn of this.UberedThisTick)
		{
			if (!this.GlowingPawns.has(Pawn))
			{
				Pawn.Glow(GetTeamColor(Pawn));
			}
		}
		this.GlowingPawns = new Set<CSPlayerPawn>(this.UberedThisTick);
	}
}

// Railer //////////////////////////////////////////////////////////////////////////////////////////

class URailerClass extends UPlayerClass<FRailerSettings>
{
	constructor()
	{
		super(RailerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
	}
}

// Common //////////////////////////////////////////////////////////////////////////////////////////

export const ClassDefinitions: Readonly<Record<EPlayableClass, UPlayerClass<FClassSettings>>> =
{
	[EPlayerClass.Demoman]: new UDemomanClass(),
	[EPlayerClass.Solider]: new USoldierClass(),
	[EPlayerClass.Medic]: new UMedicClass(),
	[EPlayerClass.Railer]: new URailerClass(),
};

export function GiveLoadout(Pawn: CSPlayerPawn, PlayerClass: EPlayableClass): void
{
	ClassDefinitions[PlayerClass].ApplyLoadout(Pawn);
}

export function GiveNoClassLoadout(Pawn: CSPlayerPawn): void
{
	StripGearSlots(Pawn, NoClassStrippedGearSlots);

	const Knife: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
	if (Knife)
	{
		Pawn.SwitchToWeapon(Knife);
	}
	else
	{
		Pawn.GiveNamedItem(NoClassMelee, true);
	}
}

export function IsWeaponAllowed(PlayerClass: EPlayerClass, Weapon: CSWeaponBase): boolean
{
	const Data: CSWeaponData | undefined = Weapon.GetData();
	if (!Data || Data.GetGearSlot() === CSGearSlot.C4)
	{
		return true;
	}

	const bIsKnife: boolean = Data.GetType() === CSWeaponType.KNIFE;
	if (PlayerClass === EPlayerClass.None)
	{
		return bIsKnife;
	}

	const Settings: FClassSettings = ClassDefinitions[PlayerClass].Settings;
	if (bIsKnife && Settings.Melee !== "")
	{
		return true;
	}
	for (const Allowed of [Settings.Primary, Settings.Secondary, Settings.Melee])
	{
		if (Allowed !== "" && IsWeapon(Weapon, Allowed))
		{
			return true;
		}
	}
	return false;
}