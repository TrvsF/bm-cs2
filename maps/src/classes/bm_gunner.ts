import type { CSPlayerPawn } from "cs_script/point_script";
import { BeamerShotgunFalloff, PlayerClass, FireHitscanWeapon } from "../bm_classes";
import type { FClassSettings, FHitscanWeaponSettings } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FGunnerSettings extends FClassSettings
{
	readonly Shotgun: FHitscanWeaponSettings;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const GunnerSettings: FGunnerSettings =
{
	DisplayName: "Gunner",
	PickFxTemplate: "gunner_pick_template",
	Primary: "weapon_mag7",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 125,
	SizeScale: 1.0,
	bStartWithMelee: true,
	PrimaryLauncher:
	{
		FireInterval: 0.75,
		ClipSize: 6,
		ReloadFirstTime: 2.0,
		ReloadEachTime: 0,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "gunner_shot_fire_template",
		ReloadFxTemplate: "gunner_shot_reload_template",
	},
	SecondaryLauncher: undefined,

	Shotgun:
	{
		Damage: 12,
		HeadshotMultiplier: 1,
		Range: 2048,
		Spread: 5,
		Pellets: 8,
		bPierces: false,
		Falloff: BeamerShotgunFalloff,
		Knockback: 250,
		SelfKnockback: 120,
		bBloodSplatter: true,
		bHeldBeam: false,
		BeamTemplate: "gunner_shot_tracer_template",
		BeamEndName: "gunner_shot_tracer_end",
		BeamLifetime: 0.06,
		ImpactTemplate: "",
		ImpactLifetime: 0,
	},
};

// Gunner //////////////////////////////////////////////////////////////////////////////////////////

export class GunnerClass extends PlayerClass<FGunnerSettings>
{
	constructor()
	{
		super(GunnerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Primary));
	}
}