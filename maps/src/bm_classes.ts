import { CSInputs, CSGearSlot } from "cs_script/point_script";
import type { CSPlayerPawn, CSWeaponBase } from "cs_script/point_script";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export enum EPlayerClass
{
	None = "none",
	Demoman = "demo",
	Solider = "soldier",
	Medic = "medic",
}

export type EPlayableClass = Exclude<EPlayerClass, EPlayerClass.None>;

export interface FClassSettings
{
	readonly Primary: string;
	readonly Secondary: string;
	readonly Health: number;
	readonly SizeScale: number;
}

export interface FSoliderSettings extends FClassSettings
{
	readonly RocketSpeed: number;
	readonly RocketDamage: number;
	readonly RocketRadius: number;
}

export interface FDemoSettings extends FClassSettings
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

export interface FMedicSettings extends FClassSettings
{
	readonly Range: number;
	readonly BreakRange: number;
	readonly HealPerSec: number;
	readonly OverhealMult: number;
	readonly OverhealDecayPerSec: number;
	readonly UberSecondsToFill: number;
	readonly UberDuration: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const SoldierSettings: FSoliderSettings =
{
	Primary: "weapon_mp7",
	Secondary: "",
	Health: 150,
	SizeScale: 1.25,

	RocketDamage: 100,
	RocketRadius: 160,
	RocketSpeed: 1200,
};

export const DemoSettings: FDemoSettings =
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

export const MedicSettings: FMedicSettings =
{
	Primary: "weapon_mp7",
	Secondary: "",
	Health: 100,
	SizeScale: 0.9,

	Range: 450,
	BreakRange: 540,
	HealPerSec: 24,
	OverhealMult: 1.5,
	OverhealDecayPerSec: 3.3,
	UberSecondsToFill: 40,
	UberDuration: 8,
};

const DefaultHealth: number = 100;
const DefaultSizeScale: number = 1.0;
const StrippedGearSlots: readonly CSGearSlot[] = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.GRENADES];

// Body ////////////////////////////////////////////////////////////////////////////////////////////

// Sets max health, current health and model size in one go
export function ApplyBody(Pawn: CSPlayerPawn, Health: number, SizeScale: number): void
{
	// Max first, otherwise SetHealth gets clamped to the old max (100)
	Pawn.SetMaxHealth(Health);
	Pawn.SetHealth(Health);
	Pawn.SetModelScale(SizeScale);
}

// Puts a player back to normal CS health and size (for !none)
export function RestoreDefaultBody(Pawn: CSPlayerPawn): void
{
	ApplyBody(Pawn, DefaultHealth, DefaultSizeScale);
}

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

// Classes /////////////////////////////////////////////////////////////////////////////////////////

abstract class UPlayerClass<TSettings extends FClassSettings>
{
	public readonly Settings: TSettings;

	constructor(Settings: TSettings)
	{
		this.Settings = Settings;
	}

	// Everything every class does on spawn. Subclasses add extras in OnLoadoutApplied.
	public ApplyLoadout(Pawn: CSPlayerPawn): void
	{
		StripGuns(Pawn);
		ApplyBody(Pawn, this.Settings.Health, this.Settings.SizeScale);

		// Skip an empty secondary, or one that's the same gun as the primary
		// (giving a second gun for the same slot makes the player drop the first one)
		const bHasSecondary: boolean = this.Settings.Secondary !== "" && this.Settings.Secondary !== this.Settings.Primary;
		if (bHasSecondary)
		{
			Pawn.GiveNamedItem(this.Settings.Secondary);
		}
		Pawn.GiveNamedItem(this.Settings.Primary, true);

		this.OnLoadoutApplied(Pawn);
	}

	// Override for class-specific setup. Runs after the shared loadout.
	protected OnLoadoutApplied(Pawn: CSPlayerPawn): void
	{
	}
}

class USoldierClass extends UPlayerClass<FSoliderSettings>
{
	constructor()
	{
		super(SoldierSettings);
	}
}

class UDemomanClass extends UPlayerClass<FDemoSettings>
{
	constructor()
	{
		super(DemoSettings);
	}
}

class UMedicClass extends UPlayerClass<FMedicSettings>
{
	constructor()
	{
		super(MedicSettings);
	}

	protected override OnLoadoutApplied(Pawn: CSPlayerPawn): void
	{
		// The knife is the medigun, so start with it out
		const Knife: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(CSGearSlot.KNIFE);
		if (Knife)
		{
			Pawn.SwitchToWeapon(Knife);
		}
	}
}

// One entry per playable class. Forget one and it won't compile.
export const ClassDefinitions: Readonly<Record<EPlayableClass, UPlayerClass<FClassSettings>>> =
{
	[EPlayerClass.Demoman]: new UDemomanClass(),
	[EPlayerClass.Solider]: new USoldierClass(),
	[EPlayerClass.Medic]: new UMedicClass(),
};

export function GiveLoadout(Pawn: CSPlayerPawn, PlayerClass: EPlayableClass): void
{
	ClassDefinitions[PlayerClass].ApplyLoadout(Pawn);
}
