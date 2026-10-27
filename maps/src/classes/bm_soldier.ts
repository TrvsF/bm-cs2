import type { CSPlayerPawn } from "cs_script/point_script";
import { LaunchProjectile, StepImpactProjectile, DestroyProjectiles, Explode } from "../bm_combat";
import type { FProjectile, FDamageFalloff } from "../bm_combat";
import { TF2RocketFalloff, PlayerClass } from "../bm_classes";
import type { FClassSettings } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FSoliderSettings extends FClassSettings
{
	readonly RocketSpeed: number;
	readonly RocketDamage: number;
	readonly RocketRadius: number;
	readonly RocketKnockback: number;
	readonly RocketLifetime: number;
	readonly RocketFalloff: FDamageFalloff | undefined;
}

export interface FRocket extends FProjectile
{
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const SoldierSettings: FSoliderSettings =
{
	DisplayName: "Soldier",
	Primary: "weapon_sg556",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 150,
	SizeScale: 1.15,
	PrimaryLauncher:
	{
		FireInterval: 0.8,
		ClipSize: 4,
		ReloadFirstTime: 0.92,
		ReloadEachTime: 0.8,
		ChargeTime: 0,
		DeployTime: 0.1,
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

const RocketTemplateName: string = "rocket_template";

// Soldier /////////////////////////////////////////////////////////////////////////////////////////

export class SoldierClass extends PlayerClass<FSoliderSettings>
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
		DestroyProjectiles(this.Rockets);
		this.Rockets = [];
	}

	private StepRocket(Rocket: FRocket, Now: number, DeltaTime: number): boolean
	{
		return StepImpactProjectile(Rocket, Now, DeltaTime, this.Settings.RocketLifetime, (): void =>
		{
			Explode(Rocket.Position, Rocket.Owner, this.Settings.RocketRadius, this.Settings.RocketDamage, this.Settings.RocketKnockback, this.Settings.RocketFalloff);
		});
	}
}