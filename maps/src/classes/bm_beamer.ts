import { CSInputs } from "cs_script/point_script";
import type { CSPlayerPawn } from "cs_script/point_script";
import { TickInterval, VectorMath, GetTeamColor, GetOrCreate, IsWeapon } from "../bm_core";
import type { FVector } from "../bm_core";
import type { FDamageCurve } from "../bm_combat";
import { SpawnHeldBeam, MoveHeldBeam, RemoveHeldBeam } from "../bm_effects";
import type { FHeldBeam } from "../bm_effects";
import { BeamerShotgunFalloff, BeamStartDrop, PlayerClass, FireHitscanWeapon, TraceHitscanWeapon } from "../bm_classes";
import type { FClassSettings, FHitscanWeaponSettings } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FBeamerSettings extends FClassSettings
{
	readonly EnergyBeam: FHitscanWeaponSettings;
	readonly Shotgun: FHitscanWeaponSettings;
}

interface FBeamerPlayerState
{
	Beam: FHeldBeam | undefined;
	LastBeamTime: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const BeamerBeamFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.0 },
	{ Distance: 512, Scale: 0.5 },
	{ Distance: 1200, Scale: 0.2 },
];

export const BeamerSettings: FBeamerSettings =
{
	DisplayName: "Beamer",
	PickFxTemplate: "beamer_pick_template",
	Primary: "weapon_negev",
	Secondary: "weapon_elite",
	Melee: "",
	Health: 200,
	SizeScale: 1.3,
	PrimaryLauncher:
	{
		FireInterval: 0.05,
		ClipSize: 111,
		ReloadFirstTime: 2.5,
		ReloadEachTime: 0,
		ChargeTime: 0,
		DeployTime: 0.1,
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
		DeployTime: 0.1,
		FireFxTemplate: "beamer_shot_fire_template",
		ReloadFxTemplate: "beamer_shot_reload_template",
	},

	EnergyBeam:
	{
		Damage: 7,
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

// Beamer //////////////////////////////////////////////////////////////////////////////////////////

export class BeamerClass extends PlayerClass<FBeamerSettings>
{
	private PlayerStates: Map<number, FBeamerPlayerState> = new Map<number, FBeamerPlayerState>();

	constructor()
	{
		super(BeamerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.EnergyBeam, Pawn.FindWeapon(this.Settings.Primary));
		this.GetPlayerState(Slot).LastBeamTime = Now;
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Secondary));
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

		const Beam: FHitscanWeaponSettings = this.Settings.EnergyBeam;
		const Start: FVector = Pawn.GetEyePosition();
		const End: FVector = TraceHitscanWeapon(Pawn, Beam, Start, VectorMath.GetForwardVector(Pawn.GetEyeAngles())).End;
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
		return GetOrCreate(this.PlayerStates, Slot, (): FBeamerPlayerState =>
		{
			return { Beam: undefined, LastBeamTime: 0 };
		});
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