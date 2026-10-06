import { Instance, CSInputs, CSGearSlot, CSDamageTypes, CSWeaponType } from "cs_script/point_script";
import type { CSPlayerPawn, CSWeaponBase } from "cs_script/point_script";
import { bDebug, TickInterval, GetPlayerState, GetTeamColor, IsWeapon, LaunchProjectile, MoveProjectile, DestroyProjectile, Explode, ApplyBulletFalloff } from "./bm_main";
import type { FProjectile, FStickyBomb, FPlayerState, FModifyDamageEvent, FModifyDamageResult, FDamageFalloff } from "./bm_main";

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
	readonly Melee: string;
	readonly Health: number;
	readonly SizeScale: number;
}

// Only for classes whose guns actually deal bullet damage
export interface FHitscanSettings
{
	readonly BulletFalloff: FDamageFalloff | undefined;   // undefined = CS2's normal range drop-off
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
	readonly DetonateKey: CSInputs;
	readonly MaxStickies: number;
	readonly ArmTime: number;
	readonly LaunchSpeed: number;
	readonly LaunchUp: number;
	readonly Radius: number;
	readonly Damage: number;
	readonly Knockback: number;
	readonly StickyFalloff: FDamageFalloff | undefined;
	readonly StickyFalloffTime: number;   // older stickies do flat damage, like TF2
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

export interface FRocket extends FProjectile
{
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const TF2HitscanFalloff: FDamageFalloff = { RampUp: 1.5, FallOff: 0.5, OptimalDistance: 512 };
const TF2RocketFalloff: FDamageFalloff = { RampUp: 1.25, FallOff: 0.5, OptimalDistance: 512 };
const TF2StickyFalloff: FDamageFalloff = { RampUp: 1.1, FallOff: 0.9, OptimalDistance: 512 };

export const SoldierSettings: FSoliderSettings =
{
	Primary: "weapon_scar20",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 150,
	SizeScale: 1.25,

	RocketDamage: 80,
	RocketRadius: 160,
	RocketSpeed: 1200,
	RocketKnockback: 400,
	RocketLifetime: 10,
	RocketFalloff: TF2RocketFalloff,
};

export const DemoSettings: FDemoSettings =
{
	Primary: "weapon_nova",
	Secondary: "weapon_glock",
	Melee: "",
	Health: 130,
	SizeScale: 1.0,

	DetonateKey: CSInputs.ATTACK2,
	MaxStickies: 6,
	ArmTime: 0.8,
	LaunchSpeed: 900,
	LaunchUp: 150,
	Radius: 160,
	Damage: 90,
	Knockback: 600,
	StickyFalloff: TF2StickyFalloff,
	StickyFalloffTime: 5,
};

export const MedicSettings: FMedicSettings =
{
	Primary: "weapon_mp7",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 150,
	SizeScale: 0.9,
	BulletFalloff: TF2HitscanFalloff,

	Range: 450,
	BreakRange: 540,
	HealPerSec: 24,
	OverhealMult: 1.5,
	OverhealDecayPerSec: 3.3,
	UberSecondsToFill: 40,
	UberDuration: 8,
};

const StickyTemplateName: string = "sticky_template";
const RocketTemplateName: string = "rocket_template";
const DefaultHealth: number = 100;
const DefaultSizeScale: number = 1.0;
const StrippedGearSlots: readonly CSGearSlot[] = [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE, CSGearSlot.GRENADES];

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

	public ApplyLoadout(Pawn: CSPlayerPawn): void
	{
		StripGuns(Pawn);
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

	// Called every tick, whether or not anyone is playing this class
	public TickWorld(Now: number, DeltaTime: number): void
	{
	}

	public OnRoundStart(): void
	{
	}

	// Override to change or block damage dealt by this class
	public ModifyOutgoingDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		return;
	}

	// True for the primary's own bullets, as opposed to explosions it causes
	protected IsPrimaryBulletDamage(Event: FModifyDamageEvent): boolean
	{
		const bIsBlast: boolean = (Event.damageTypes & CSDamageTypes.BLAST) !== 0;
		return !bIsBlast && IsWeapon(Event.weapon, this.Settings.Primary);
	}
}

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

	public override ModifyOutgoingDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		if (this.IsPrimaryBulletDamage(Event))
		{
			return { abort: true };
		}
		return;
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

class UDemomanClass extends UPlayerClass<FDemoSettings>
{
	constructor()
	{
		super(DemoSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Sticky: FStickyBomb =
		{
			...LaunchProjectile(Pawn, this.Settings.LaunchSpeed, this.Settings.LaunchUp, 1, StickyTemplateName),
			bStuck: false,
			ArmedAt: Now + this.Settings.ArmTime,
		};

		const State: FPlayerState = GetPlayerState(Slot);
		State.Stickies.push(Sticky);
		if (!bDebug)
		{
			while (State.Stickies.length > this.Settings.MaxStickies)
			{
				const Oldest: FStickyBomb | undefined = State.Stickies.shift(); // oldest fizzles
				if (Oldest)
				{
					DestroyProjectile(Oldest);
				}
			}
		}
	}

	public override ModifyOutgoingDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		// Only the stickies hurt, not the Nova's pellets
		if (this.IsPrimaryBulletDamage(Event))
		{
			return { abort: true };
		}
		return;
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

	public override ModifyOutgoingDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		// The knife is the medigun, so it never deals damage
		if (Event.weapon && Event.weapon.GetData().GetType() === CSWeaponType.KNIFE)
		{
			return { abort: true };
		}
		return ApplyBulletFalloff(Event, this.Settings.BulletFalloff);
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