import type { CSPlayerPawn } from "cs_script/point_script";
import { VectorMath, GetTeamColor, IsWeapon } from "../bm_core";
import type { FVector } from "../bm_core";
import type { FDamageCurve } from "../bm_combat";
import { SpawnHeldBeam, MoveHeldBeam, RemoveHeldBeam } from "../bm_effects";
import type { FHeldBeam } from "../bm_effects";
import { GetLauncherAmmo } from "../bm_launcher";
import type { FLauncherAmmo } from "../bm_launcher";
import { BeamStartDrop, PlayerClass, FireHitscanWeapon, TraceHitscanWeapon } from "../bm_classes";
import type { FClassSettings, FHitscanWeaponSettings } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FRailerSettings extends FClassSettings
{
	readonly PPsh: FHitscanWeaponSettings;
	readonly Railgun: FHitscanWeaponSettings;
	readonly ChargeBeamTemplate: string;
	readonly ChargeBeamEndName: string;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

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

export const RailerSettings: FRailerSettings =
{
	DisplayName: "Railer",
	PickFxTemplate: "railer_pick_template",
	Primary: "weapon_famas",
	Secondary: "weapon_revolver",
	Melee: "",
	bStartWithSecondary: true,
	Health: 110,
	SizeScale: 0.85,
	PrimaryLauncher:
	{
		FireInterval: 0.06,
		ClipSize: 20,
		ReloadFirstTime: 1.6,
		ReloadEachTime: 0,
		ChargeTime: 0,
		DeployTime: 0.1,
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
		DeployTime: 0.1,
		FireFxTemplate: "rail_fire_template",
		ReloadFxTemplate: "rail_reload_template",
	},

	PPsh:
	{
		Damage: 8,
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

	ChargeBeamTemplate: "rail_charge_beam_template",
	ChargeBeamEndName: "rail_charge_beam_end",
};

// Railer //////////////////////////////////////////////////////////////////////////////////////////

export class RailerClass extends PlayerClass<FRailerSettings>
{
	private ChargeBeams: Map<number, FHeldBeam> = new Map<number, FHeldBeam>();

	constructor()
	{
		super(RailerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.PPsh, Pawn.FindWeapon(this.Settings.Primary));
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.Railgun, Pawn.FindWeapon(this.Settings.Secondary));
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const Ammo: FLauncherAmmo | undefined = GetLauncherAmmo(Pawn, Slot);
		const bCharging: boolean = Ammo !== undefined && Ammo.ChargeFraction > 0 && IsWeapon(Pawn.GetActiveWeapon(), this.Settings.Secondary);
		if (!bCharging)
		{
			this.StopChargeBeam(Slot);
			return;
		}

		const Start: FVector = Pawn.GetEyePosition();
		const End: FVector = TraceHitscanWeapon(Pawn, this.Settings.Railgun, Start, VectorMath.GetForwardVector(Pawn.GetEyeAngles())).End;
		const BeamStart: FVector = VectorMath.Subtract(Start, BeamStartDrop);
		const Beam: FHeldBeam | undefined = this.ChargeBeams.get(Slot);
		if (Beam)
		{
			MoveHeldBeam(Beam, BeamStart, End);
		}
		else
		{
			this.ChargeBeams.set(Slot, SpawnHeldBeam(this.Settings.ChargeBeamTemplate, this.Settings.ChargeBeamEndName, BeamStart, End, GetTeamColor(Pawn)));
		}
	}

	public override OnRoundStart(): void
	{
		for (const Slot of [...this.ChargeBeams.keys()])
		{
			this.StopChargeBeam(Slot);
		}
	}

	public override ClearPlayer(Slot: number): void
	{
		this.StopChargeBeam(Slot);
	}

	private StopChargeBeam(Slot: number): void
	{
		const Beam: FHeldBeam | undefined = this.ChargeBeams.get(Slot);
		if (Beam)
		{
			RemoveHeldBeam(Beam);
			this.ChargeBeams.delete(Slot);
		}
	}
}