import { Instance, CSInputs, CSGearSlot, CSDamageTypes, CSDamageFlags, CSWeaponType, CSHitGroup } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CSWeaponBase, CSWeaponData, TraceResult } from "cs_script/point_script";
import { bDebug, TickInterval, LogPrefix, VectorMath, GetTeamColor, GetChestPosition, GetPlayerSlot, IsPlayerPawn, IsWeapon, ForEachLivePawn } from "./bm_core";
import type { FVector, FRotator, FColor, FModifyDamageEvent, FModifyDamageResult } from "./bm_core";
import { LaunchProjectile, MoveProjectile, MoveBouncingProjectile, DestroyProjectile, TintProjectile, Explode, ApplyBulletFalloff, EvaluateDamageCurve, TraceHitscan, GetSpreadDirection, ApplyKnockback } from "./bm_combat";
import type { FProjectile, FBouncingProjectile, FBounceSettings, FDamageFalloff, FDamageCurve, FHitscanHit, FHitscanResult } from "./bm_combat";
import { SpawnBloodSplatter, SpawnBeam, SpawnHeldBeam, MoveHeldBeam, RemoveHeldBeam, SpawnTemporaryTemplate } from "./bm_effects";
import type { FHeldBeam } from "./bm_effects";
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
	Beamer = "beamer",
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

export interface FHudCounter
{
	readonly Label: string;
	readonly Count: number;
	readonly Max: number;
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
	readonly PipeRolledDamageScale: number,
	readonly PipeKnockback: number,
	readonly PipeFalloff: FDamageFalloff | undefined,
	readonly PipeFuseTime: number,
	readonly PipeBounce: FBounceSettings,
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

export interface FBeamWeaponSettings
{
	readonly Damage: number;
	readonly HeadshotMultiplier: number;
	readonly Range: number;
	readonly Spread: number;
	readonly Pellets: number;
	readonly bPierces: boolean;
	readonly Falloff: FDamageCurve;
	readonly Knockback: number;
	readonly SelfKnockback: number;
	readonly bBloodSplatter: boolean;
	readonly bHeldBeam: boolean;
	readonly BeamTemplate: string;
	readonly BeamEndName: string;
	readonly BeamLifetime: number;
	readonly ImpactTemplate: string;
	readonly ImpactLifetime: number;
}

export interface FRailerSettings extends FClassSettings
{
	readonly PPsh: FBeamWeaponSettings;
	readonly Railgun: FBeamWeaponSettings;
}

export interface FBeamerSettings extends FClassSettings
{
	readonly EnergyBeam: FBeamWeaponSettings;
	readonly Shotgun: FBeamWeaponSettings;
}

export interface FRocket extends FProjectile
{
}

export interface FPipe extends FBouncingProjectile
{
}

export interface FStickyBomb extends FProjectile
{
	bStuck: boolean;
	ArmedAt: number;
	bTintedArmed: boolean;
}

interface FDemoPlayerState
{
	Stickies: FStickyBomb[];
	bDetonateHeld: boolean;
}

interface FBeamerPlayerState
{
	Beam: FHeldBeam | undefined;
	LastBeamTime: number;
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

const RailerShotFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.0 },
	{ Distance: 512, Scale: 1.0 },
	{ Distance: 1536, Scale: 0.4 },
];

const RailerBeamFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.0 },
	{ Distance: 1024, Scale: 1.0 },
	{ Distance: 3072, Scale: 0.5 },
];

const BeamerBeamFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.0 },
	{ Distance: 512, Scale: 0.5 },
	{ Distance: 1200, Scale: 0.2 },
];

const BeamerShotgunFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.0 },
	{ Distance: 256, Scale: 1.0 },
	{ Distance: 1024, Scale: 0.3 },
];

export const SoldierSettings: FSoliderSettings =
{
	DisplayName: "Soldier",
	Primary: "weapon_m4a1",
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
		ChargeTime: 0,
		FireFxTemplate: "rocket_fire_template",
		ReloadFxTemplate: "rocket_reload_template",
	},
	SecondaryLauncher: undefined,

	RocketDamage: 90,
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
		ChargeTime: 0,
		FireFxTemplate: "sticky_fire_template",
		ReloadFxTemplate: "sticky_reload_template",
	},
	SecondaryLauncher:
	{
		FireInterval: 0.6,
		ClipSize: 4,
		ReloadFirstTime: 1.24,
		ReloadEachTime: 0.6,
		ChargeTime: 0,
		FireFxTemplate: "pipe_fire_template",
		ReloadFxTemplate: "pipe_reload_template",
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
	PipeDamage: 75,
	PipeRolledDamageScale: 0.6,
	PipeKnockback: 1000,
	PipeFalloff: TF2RocketFalloff,
	PipeFuseTime: 1.6,
	PipeBounce:
	{
		Restitution: 0.2,
		ImpactFriction: 0.5,
		RollFriction: 1200,
		SettleSpeed: 100,
	},
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
	Primary: "weapon_famas",
	Secondary: "weapon_revolver",
	Melee: "",
	Health: 100,
	SizeScale: 0.8,
	PrimaryLauncher:
	{
		FireInterval: 0.08,
		ClipSize: 20,
		ReloadFirstTime: 1.6,
		ReloadEachTime: 0,
		ChargeTime: 0,
		FireFxTemplate: "rail_shot_fire_template",
		ReloadFxTemplate: "rail_shot_reload_template",
	},
	SecondaryLauncher:
	{
		FireInterval: 0.5,
		ClipSize: 1,
		ReloadFirstTime: 3,
		ReloadEachTime: 3,
		ChargeTime: 1,
		FireFxTemplate: "rail_fire_template",
		ReloadFxTemplate: "rail_reload_template",
	},

	PPsh:
	{
		Damage: 7,
		HeadshotMultiplier: 1,
		Range: 4096,
		Spread: 2,
		Pellets: 1,
		bPierces: false,
		Falloff: RailerShotFalloff,
		Knockback: 400,
		SelfKnockback: 200,
		bBloodSplatter: false,
		bHeldBeam: false,
		BeamTemplate: "rail_tracer_template",
		BeamEndName: "rail_tracer_end",
		BeamLifetime: 0.06,
		ImpactTemplate: "",
		ImpactLifetime: 0,
	},

	Railgun:
	{
		Damage: 110,
		HeadshotMultiplier: 1.5,
		Range: 8192,
		Spread: 0,
		Pellets: 1,
		bPierces: true,
		Falloff: RailerBeamFalloff,
		Knockback: 333,
		SelfKnockback: 333,
		bBloodSplatter: true,
		bHeldBeam: false,
		BeamTemplate: "rail_beam_template",
		BeamEndName: "rail_beam_end",
		BeamLifetime: 0.4,
		ImpactTemplate: "rail_impact_template",
		ImpactLifetime: 2,
	},
};

export const BeamerSettings: FBeamerSettings =
{
	DisplayName: "Beamer",
	Primary: "weapon_negev",
	Secondary: "weapon_elite",
	Melee: "",
	Health: 200,
	SizeScale: 1.4,
	PrimaryLauncher:
	{
		FireInterval: 0.05,
		ClipSize: 100,
		ReloadFirstTime: 2.5,
		ReloadEachTime: 0,
		ChargeTime: 0,
		FireFxTemplate: "",
		ReloadFxTemplate: "beamer_beam_reload_template",
	},
	SecondaryLauncher:
	{
		FireInterval: 0.3,
		ClipSize: 2,
		ReloadFirstTime: 1.4,
		ReloadEachTime: 0,
		ChargeTime: 0,
		FireFxTemplate: "beamer_shot_fire_template",
		ReloadFxTemplate: "beamer_shot_reload_template",
	},

	EnergyBeam:
	{
		Damage: 5,
		HeadshotMultiplier: 1,
		Range: 2048,
		Spread: 0,
		Pellets: 1,
		bPierces: false,
		Falloff: BeamerBeamFalloff,
		Knockback: 0,
		SelfKnockback: 0,
		bBloodSplatter: false,
		bHeldBeam: true,
		BeamTemplate: "beamer_beam_template",
		BeamEndName: "beamer_beam_end",
		BeamLifetime: 0,
		ImpactTemplate: "",
		ImpactLifetime: 0,
	},

	Shotgun:
	{
		Damage: 10,
		HeadshotMultiplier: 1,
		Range: 2048,
		Spread: 6,
		Pellets: 10,
		bPierces: false,
		Falloff: BeamerShotgunFalloff,
		Knockback: 600,
		SelfKnockback: 200,
		bBloodSplatter: false,
		bHeldBeam: false,
		BeamTemplate: "beamer_shot_tracer_template",
		BeamEndName: "beamer_shot_tracer_end",
		BeamLifetime: 0.06,
		ImpactTemplate: "",
		ImpactLifetime: 0,
	},
};

const PlayableClasses: readonly EPlayableClass[] = Object.values(EPlayerClass).filter((PlayerClass: EPlayerClass): PlayerClass is EPlayableClass =>
{
	return PlayerClass !== EPlayerClass.None;
});

const StickyTemplateName: string = "sticky_template";
const RocketTemplateName: string = "rocket_template";
const PipeTemplateName: string = "pipe_template";
const MaxBeamHits: number = 8;
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

function IsBulletDamage(Event: FModifyDamageEvent): boolean
{
	return (Event.damageTypes & (CSDamageTypes.BULLET | CSDamageTypes.BUCKSHOT)) !== 0;
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

abstract class PlayerClass<TSettings extends FClassSettings>
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

	// Override to put a counter on this class's HUD. undefined = none.
	public GetHudCounter(Slot: number): FHudCounter | undefined
	{
		return undefined;
	}

	// True for the primary's own bullets, as opposed to explosions or beams the script deals in its name
	protected IsPrimaryBulletDamage(Event: FModifyDamageEvent): boolean
	{
		return IsBulletDamage(Event) && IsWeapon(Event.weapon, this.Settings.Primary);
	}

	// True for the secondary's own bullets
	protected IsSecondaryBulletDamage(Event: FModifyDamageEvent): boolean
	{
		return IsBulletDamage(Event) && this.Settings.Secondary !== "" && IsWeapon(Event.weapon, this.Settings.Secondary);
	}
}

// Soldier /////////////////////////////////////////////////////////////////////////////////////////

class SoldierClass extends PlayerClass<FSoliderSettings>
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

		if (Rocket.Models.length === 0)
		{
			Instance.DebugSphere({ center: Rocket.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Rocket.Owner) });
		}
		return true;
	}
}

// Demoman /////////////////////////////////////////////////////////////////////////////////////////

class DemomanClass extends PlayerClass<FDemoSettings>
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
			bTintedArmed: false,
		};
		TintProjectile(Sticky, UnarmedStickyColor);

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
		const Pipe: FPipe =
		{
			...LaunchProjectile(Pawn, this.Settings.PipeLaunchSpeed, this.Settings.PipeLaunchUp, 1, PipeTemplateName),
			bTouchedWorld: false,
			GroundNormal: undefined,
		};
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
			const bArmed: boolean = Now >= Sticky.ArmedAt;
			if (Sticky.Models.length === 0)
			{
				Instance.DebugSphere({ center: Sticky.Position, radius: 4, duration: TickInterval * 2, color: bArmed ? GetTeamColor(Pawn) : UnarmedStickyColor });
			}
			else if (bArmed && !Sticky.bTintedArmed)
			{
				TintProjectile(Sticky, GetTeamColor(Pawn));
				Sticky.bTintedArmed = true;
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

	public override GetHudCounter(Slot: number): FHudCounter | undefined
	{
		const State: FDemoPlayerState | undefined = this.PlayerStates.get(Slot);
		return { Label: "Stickies", Count: State ? State.Stickies.length : 0, Max: bDebug ? 0 : this.Settings.StickyMax };
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
		if (!Pipe.Owner.IsValid())
		{
			DestroyProjectile(Pipe);
			return false;
		}

		if (Now - Pipe.SpawnedAt >= this.Settings.PipeFuseTime || MoveBouncingProjectile(Pipe, DeltaTime, !Pipe.bTouchedWorld, this.Settings.PipeBounce))
		{
			this.DetonatePipe(Pipe);
			return false;
		}

		if (Pipe.Models.length === 0)
		{
			Instance.DebugSphere({ center: Pipe.Position, radius: 3, duration: TickInterval * 2, color: GetTeamColor(Pipe.Owner) });
		}
		return true;
	}

	private DetonatePipe(Pipe: FPipe): void
	{
		DestroyProjectile(Pipe);
		const Damage: number = this.Settings.PipeDamage * (Pipe.bTouchedWorld ? this.Settings.PipeRolledDamageScale : 1);
		Explode(Pipe.Position, Pipe.Owner, this.Settings.PipeRadius, Damage, this.Settings.PipeKnockback, this.Settings.PipeFalloff);
	}
}

// Medic ///////////////////////////////////////////////////////////////////////////////////////////

class MedicClass extends PlayerClass<FMedicSettings>
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
				start: VectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
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
		if (VectorMath.Size(VectorMath.Subtract(TargetChest, EyePosition)) > this.Settings.BreakRange)
		{
			return false;
		}
		return !Instance.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
	}

	private AcquireHealTarget(Medic: CSPlayerPawn): CSPlayerPawn | undefined
	{
		const EyePosition: FVector = Medic.GetEyePosition();
		const Forward: FVector = VectorMath.GetForwardVector(Medic.GetEyeAngles());
		const End: FVector = VectorMath.Add(EyePosition, VectorMath.Scale(Forward, this.Settings.Range));
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

class RailerClass extends PlayerClass<FRailerSettings>
{
	constructor()
	{
		super(RailerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireBeamWeapon(Pawn, this.Settings.PPsh, Pawn.FindWeapon(this.Settings.Primary));
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireBeamWeapon(Pawn, this.Settings.Railgun, Pawn.FindWeapon(this.Settings.Secondary));
	}
}

// Fires one shot: each pellet is its own hitscan ray, and the shooter is pushed back once for the whole shot
function FireBeamWeapon(Shooter: CSPlayerPawn, Settings: FBeamWeaponSettings, Weapon: CSWeaponBase | undefined): void
{
	const Start: FVector = Shooter.GetEyePosition();
	const Aim: FRotator = Shooter.GetEyeAngles();
	for (let Pellet: number = 0; Pellet < Settings.Pellets; Pellet++)
	{
		const Direction: FVector = GetSpreadDirection(Aim, Settings.Spread);
		const Result: FHitscanResult = TraceBeamWeapon(Shooter, Settings, Start, Direction);
		for (const Hit of Result.Hits)
		{
			const Distance: number = GetHitDistance(Hit, Start);
			const RangeScale: number = EvaluateDamageCurve(Settings.Falloff, Distance);
			const bHeadshot: boolean = Hit.Trace.hitGroup === CSHitGroup.HEAD;
			const Damage: number = Settings.Damage * RangeScale * (bHeadshot ? Settings.HeadshotMultiplier : 1);

			ApplyKnockback(Hit.Victim, Direction, Damage, Settings.Knockback, false);
			if (DealShockDamage(Shooter, Hit.Victim, Damage, Weapon) > 0 && Settings.bBloodSplatter)
			{
				SpawnBloodSplatter(Start, Hit.Victim);
			}
		}

		if (!Settings.bHeldBeam)
		{
			SpawnBeam(Settings.BeamTemplate, Settings.BeamEndName, VectorMath.Subtract(Start, BeamStartDrop), Result.End, Settings.BeamLifetime, GetTeamColor(Shooter));
		}
		if (Settings.ImpactTemplate !== "")
		{
			SpawnTemporaryTemplate(Settings.ImpactTemplate, Result.End, Settings.ImpactLifetime);
		}
	}

	const Backwards: FVector = VectorMath.Scale(VectorMath.GetForwardVector(Aim), -1);
	ApplyKnockback(Shooter, Backwards, Settings.Damage * Settings.Pellets, Settings.SelfKnockback, true);
}

function TraceBeamWeapon(Shooter: CSPlayerPawn, Settings: FBeamWeaponSettings, Start: FVector, Direction: FVector): FHitscanResult
{
	const MaxHits: number = Settings.bPierces ? MaxBeamHits : 1;
	return TraceHitscan(Shooter, Start, VectorMath.Add(Start, VectorMath.Scale(Direction, Settings.Range)), MaxHits);
}

function GetHitDistance(Hit: FHitscanHit, Start: FVector): number
{
	return VectorMath.Size(VectorMath.Subtract(Hit.Trace.end, Start));
}

function DealShockDamage(Shooter: CSPlayerPawn, Victim: CSPlayerPawn, Damage: number, Weapon: CSWeaponBase | undefined): number
{
	return Victim.TakeDamage(
	{
		damage: Damage,
		damageTypes: CSDamageTypes.SHOCK,
		damageFlags: CSDamageFlags.IGNORE_ARMOR,
		attacker: Shooter,
		inflictor: Shooter,
		weapon: Weapon,
	});
}

// Beamer //////////////////////////////////////////////////////////////////////////////////////////

class BeamerClass extends PlayerClass<FBeamerSettings>
{
	private PlayerStates: Map<number, FBeamerPlayerState> = new Map<number, FBeamerPlayerState>();

	constructor()
	{
		super(BeamerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireBeamWeapon(Pawn, this.Settings.EnergyBeam, Pawn.FindWeapon(this.Settings.Primary));
		this.GetPlayerState(Slot).LastBeamTime = Now;
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireBeamWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Secondary));
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FBeamerPlayerState | undefined = this.PlayerStates.get(Slot);
		if (!State)
		{
			return;
		}
		if (!this.IsBeamOn(Pawn, State, Now))
		{
			this.StopBeam(State);
			return;
		}

		const Beam: FBeamWeaponSettings = this.Settings.EnergyBeam;
		const Start: FVector = Pawn.GetEyePosition();
		const End: FVector = TraceBeamWeapon(Pawn, Beam, Start, VectorMath.GetForwardVector(Pawn.GetEyeAngles())).End;
		const BeamStart: FVector = VectorMath.Subtract(Start, BeamStartDrop);
		if (State.Beam)
		{
			MoveHeldBeam(State.Beam, BeamStart, End);
		}
		else
		{
			State.Beam = SpawnHeldBeam(Beam.BeamTemplate, Beam.BeamEndName, BeamStart, End, GetTeamColor(Pawn));
		}
	}

	public override OnRoundStart(): void
	{
		for (const Slot of this.PlayerStates.keys())
		{
			this.ClearPlayer(Slot);
		}
	}

	public override ClearPlayer(Slot: number): void
	{
		const State: FBeamerPlayerState | undefined = this.PlayerStates.get(Slot);
		if (State)
		{
			this.StopBeam(State);
			this.PlayerStates.delete(Slot);
		}
	}

	private GetPlayerState(Slot: number): FBeamerPlayerState
	{
		let State: FBeamerPlayerState | undefined = this.PlayerStates.get(Slot);
		if (!State)
		{
			State = { Beam: undefined, LastBeamTime: 0 };
			this.PlayerStates.set(Slot, State);
		}
		return State;
	}

	private IsBeamOn(Pawn: CSPlayerPawn, State: FBeamerPlayerState, Now: number): boolean
	{
		const FireInterval: number = this.Settings.PrimaryLauncher ? this.Settings.PrimaryLauncher.FireInterval : 0;
		const bStillFiring: boolean = Now - State.LastBeamTime <= FireInterval + TickInterval * 1.5;
		return bStillFiring && Pawn.IsInputPressed(CSInputs.ATTACK) && IsWeapon(Pawn.GetActiveWeapon(), this.Settings.Primary);
	}

	private StopBeam(State: FBeamerPlayerState): void
	{
		if (State.Beam)
		{
			RemoveHeldBeam(State.Beam);
			State.Beam = undefined;
		}
	}
}

// Common //////////////////////////////////////////////////////////////////////////////////////////

export const ClassDefinitions: Readonly<Record<EPlayableClass, PlayerClass<FClassSettings>>> =
{
	[EPlayerClass.Demoman]: new DemomanClass(),
	[EPlayerClass.Solider]: new SoldierClass(),
	[EPlayerClass.Medic]: new MedicClass(),
	[EPlayerClass.Railer]: new RailerClass(),
	[EPlayerClass.Beamer]: new BeamerClass(),
};

export function GiveLoadout(Pawn: CSPlayerPawn, PlayerClass: EPlayableClass): void
{
	ClassDefinitions[PlayerClass].ApplyLoadout(Pawn);
}

export function PickRandomClass(): EPlayableClass
{
	const Index: number = Math.floor(Math.random() * PlayableClasses.length);
	return PlayableClasses[Index] ?? EPlayerClass.Solider;
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