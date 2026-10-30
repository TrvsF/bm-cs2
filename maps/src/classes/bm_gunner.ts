import { Instance, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, TraceResult } from "cs_script/point_script";
import { TickInterval, VectorMath, GetChestPosition, GetTeamColor, GetOrCreate, IsKnife, ConsumePress, ForEachLivePawn } from "../bm_core";
import type { FVector, FRotator, FHeldInputs } from "../bm_core";
import { BuildingKind, GetOwnedBuildings, GetBuildingEntities, IsBuildingEnemy, TurnBuilding, TickBuildTool, CancelPlacement, GetPlacingKind, IsRepairingBuilding } from "../bm_buildings";
import type { FBuilding, FBuildingSettings, FBuildKeys } from "../bm_buildings";
import { BeamerShotgunFalloff, PlayerClass, FireHitscanWeapon, FireHitscan } from "../bm_classes";
import type { FClassSettings, FHitscanWeaponSettings, FHudCounter } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FTurretSettings extends FBuildingSettings
{
	readonly FireInterval: number;
	readonly ArmTime: number;
	readonly MuzzleHeight: number;
	readonly Gun: FHitscanWeaponSettings;
}

export interface FGunnerSettings extends FClassSettings
{
	readonly Shotgun: FHitscanWeaponSettings;
	readonly HeavyTurret: FTurretSettings;
	readonly RapidTurret: FTurretSettings;
}

interface FTurretState
{
	ArmedAt: number;
	NextFireTime: number;
}

interface FGunnerPlayerState
{
	Held: FHeldInputs;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const GunnerSettings: FGunnerSettings =
{
	DisplayName: "Builder",
	PickFxTemplate: "gunner_pick_template",
	Primary: "weapon_mag7",
	Secondary: "",
	Melee: "weapon_spanner",
	Health: 125,
	SizeScale: 1.1,
	Model: "agents/models/otakku/rochelle/rochelle.vmdl",
	bStartWithMelee: true,
	MeleeDamage: 0,
	RepairPerHit: 25,
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
		SelfKnockback: 150,
		bBloodSplatter: true,
		bHeldBeam: false,
		BeamTemplate: "gunner_shot_tracer_template",
		BeamEndName: "gunner_shot_tracer_end",
		BeamLifetime: 0.06,
		ImpactTemplate: "",
		ImpactLifetime: 0,
	},

	HeavyTurret:
	{
		DisplayName: "Heavy Turret",
		ModelTemplate: "gunner_heavy_turret_template",
		PreviewTemplate: "gunner_heavy_turret_preview_template",
		DestroyFxTemplate: "gunner_turret_destroy_template",
		Health: 75,
		HalfWidth: 18,
		Height: 48,
		ThrowSpeed: 450,
		MaxCount: 1,
		RebuildDelay: 10,
		FireInterval: 2.0,
		ArmTime: 1.0,
		MuzzleHeight: 40,
		Gun:
		{
			Damage: 40,
			HeadshotMultiplier: 1,
			Range: 1600,
			Spread: 0,
			Pellets: 1,
			bPierces: false,
			Falloff: [],
			Knockback: 1200,
			SelfKnockback: 0,
			bBloodSplatter: true,
			bHeldBeam: false,
			BeamTemplate: "gunner_heavy_turret_tracer_template",
			BeamEndName: "gunner_heavy_turret_tracer_end",
			BeamLifetime: 0.2,
			ImpactTemplate: "",
			ImpactLifetime: 0,
		},
	},

	RapidTurret:
	{
		DisplayName: "Rapid Turret",
		ModelTemplate: "gunner_rapid_turret_template",
		PreviewTemplate: "gunner_rapid_turret_preview_template",
		DestroyFxTemplate: "gunner_turret_destroy_template",
		Health: 50,
		HalfWidth: 16,
		Height: 40,
		ThrowSpeed: 450,
		MaxCount: 1,
		RebuildDelay: 10,
		FireInterval: 0.12,
		ArmTime: 1.0,
		MuzzleHeight: 32,
		Gun:
		{
			Damage: 4,
			HeadshotMultiplier: 1,
			Range: 1200,
			Spread: 2,
			Pellets: 1,
			bPierces: false,
			Falloff: [],
			Knockback: 2000,
			SelfKnockback: 0,
			bBloodSplatter: false,
			bHeldBeam: false,
			BeamTemplate: "gunner_rapid_turret_tracer_template",
			BeamEndName: "gunner_rapid_turret_tracer_end",
			BeamLifetime: 0.05,
			ImpactTemplate: "",
			ImpactLifetime: 0,
		},
	},
};

const MaxTurrets: number = 2;

// Turret //////////////////////////////////////////////////////////////////////////////////////////

export class TurretKind extends BuildingKind<FTurretSettings>
{
	private States: Map<FBuilding, FTurretState> = new Map<FBuilding, FTurretState>();

	public override OnPlaced(Building: FBuilding, Now: number): void
	{
		this.States.set(Building, { ArmedAt: Now + this.Settings.ArmTime, NextFireTime: Now + this.Settings.ArmTime });
	}

	public override OnRemoved(Building: FBuilding): void
	{
		this.States.delete(Building);
	}

	public override Tick(Building: FBuilding, Now: number, DeltaTime: number): void
	{
		const State: FTurretState | undefined = this.States.get(Building);
		const Muzzle: FVector = VectorMath.Add(Building.Position, { x: 0, y: 0, z: this.Settings.MuzzleHeight });
		const Target: CSPlayerPawn | undefined = State ? this.FindTarget(Building, Muzzle) : undefined;
		if (!State || !Target)
		{
			return;
		}

		const Chest: FVector = GetChestPosition(Target);
		const Aim: FRotator = VectorMath.GetRotation(VectorMath.Subtract(Chest, Muzzle));
		TurnBuilding(Building, Aim.yaw);
		Instance.DebugLine({ start: Muzzle, end: Chest, duration: TickInterval * 2, color: GetTeamColor(Building.Owner) });
		if (Now < State.NextFireTime)
		{
			return;
		}
		State.NextFireTime = Now + this.Settings.FireInterval;
		Building.DamageDealt += FireHitscan(Building.Owner, this.Settings.Gun, undefined, Muzzle, Aim, Muzzle);
	}

	public override GetStatus(Building: FBuilding, Now: number): string
	{
		const State: FTurretState | undefined = this.States.get(Building);
		return State && Now < State.ArmedAt ? "Arming" : `${Math.round(Building.DamageDealt)} dmg`;
	}

	private FindTarget(Building: FBuilding, Muzzle: FVector): CSPlayerPawn | undefined
	{
		const Ignored: Entity[] = GetBuildingEntities(Building);
		let Target: CSPlayerPawn | undefined = undefined;
		let TargetDistance: number = this.Settings.Gun.Range;
		ForEachLivePawn((Pawn: CSPlayerPawn): void =>
		{
			if (!IsBuildingEnemy(Building, Pawn))
			{
				return;
			}
			const Chest: FVector = GetChestPosition(Pawn);
			const Distance: number = VectorMath.Size(VectorMath.Subtract(Chest, Muzzle));
			if (Distance > TargetDistance)
			{
				return;
			}
			const Sight: TraceResult = Instance.TraceLine({ start: Muzzle, end: Chest, ignorePlayers: true, ignoreEntity: Ignored });
			if (Sight.didHit && !Sight.startedInSolid)
			{
				return;
			}
			Target = Pawn;
			TargetDistance = Distance;
		});
		return Target;
	}
}

// Gunner //////////////////////////////////////////////////////////////////////////////////////////

export class GunnerClass extends PlayerClass<FGunnerSettings>
{
	private readonly HeavyTurret: TurretKind = new TurretKind(GunnerSettings.HeavyTurret);
	private readonly RapidTurret: TurretKind = new TurretKind(GunnerSettings.RapidTurret);
	private readonly BuildKeys: FBuildKeys = { Left: { Label: "Heavy Turret", Kinds: [this.HeavyTurret] }, Right: { Label: "Rapid Turret", Kinds: [this.RapidTurret] } };
	private PlayerStates: Map<number, FGunnerPlayerState> = new Map<number, FGunnerPlayerState>();

	constructor()
	{
		super(GunnerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Primary));
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FGunnerPlayerState = this.GetPlayerState(Slot);
		const bLeftPressed: boolean = ConsumePress(Pawn, State.Held, CSInputs.ATTACK);
		const bRightPressed: boolean = ConsumePress(Pawn, State.Held, CSInputs.ATTACK2);
		const bRepairing: boolean = (bLeftPressed || bRightPressed) && GetPlacingKind(Slot) === undefined && IsRepairingBuilding(Pawn, Slot, Now);
		TickBuildTool(Pawn, Slot, this.GetBuildKeys(Pawn), bLeftPressed && !bRepairing, bRightPressed && !bRepairing, Now);
	}

	public override GetBuildKeys(Pawn: CSPlayerPawn): FBuildKeys | undefined
	{
		return IsKnife(Pawn.GetActiveWeapon()) ? this.BuildKeys : undefined;
	}

	public override ClearPlayer(Slot: number): void
	{
		CancelPlacement(Slot);
		this.PlayerStates.delete(Slot);
	}

	public override GetHudCounter(Slot: number): FHudCounter | undefined
	{
		return { Label: "Turrets", Count: GetOwnedBuildings(Slot).length, Max: MaxTurrets };
	}

	private GetPlayerState(Slot: number): FGunnerPlayerState
	{
		return GetOrCreate(this.PlayerStates, Slot, (): FGunnerPlayerState =>
		{
			return { Held: { Mask: 0 } };
		});
	}
}
