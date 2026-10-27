import { Console } from "cs_script/point_script";
import type { CSPlayerPawn } from "cs_script/point_script";
import { LogPrefix, VectorMath, GetPawnName, IsTeammate } from "../bm_core";
import { EProjectileShape, LaunchProjectile, MovePiercingProjectile, IsProjectileExpired, DrawMissingProjectile, DestroyProjectile, DestroyProjectiles, EvaluateDamageCurve, ApplyKnockback } from "../bm_combat";
import type { FProjectile, FPiercingProjectile, FPiercingStep, FDamageCurve, FHitscanHit } from "../bm_combat";
import { SpawnBloodSplatter } from "../bm_effects";
import { BeamerShotgunFalloff, PlayerClass, FireHitscanWeapon, DealShockDamage } from "../bm_classes";
import type { FClassSettings, FBeamWeaponSettings } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FBoxerSettings extends FClassSettings
{
	readonly CubeSpeed: number;
	readonly CubeGravityScale: number;
	// Half the cube's width, from its centre to each face
	readonly CubeRadius: number;
	readonly CubeDamage: number;
	readonly CubeFalloff: FDamageCurve;
	readonly CubeKnockback: number;
	readonly CubeLifetime: number;
	readonly Shotgun: FBeamWeaponSettings;
}

export interface FCube extends FPiercingProjectile
{
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const BoxerCubeFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.0 },
	{ Distance: 512, Scale: 1.0 },
	{ Distance: 2048, Scale: 0.5 },
];

export const BoxerSettings: FBoxerSettings =
{
	DisplayName: "Boxer",
	Primary: "weapon_m249",
	Secondary: "weapon_deagle",
	Melee: "",
	Health: 150,
	SizeScale: 1.25,
	PrimaryLauncher:
	{
		FireInterval: 0.8,
		ClipSize: 1,
		ReloadFirstTime: 1.0,
		ReloadEachTime: 0.8,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "cube_fire_template",
		ReloadFxTemplate: "cube_reload_template",
	},
	SecondaryLauncher:
	{
		FireInterval: 0.625,
		ClipSize: 4,
		ReloadFirstTime: 0.7,
		ReloadEachTime: 0.5,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "boxer_shot_fire_template",
		ReloadFxTemplate: "boxer_shot_reload_template",
	},

	CubeSpeed: 1400,
	CubeGravityScale: 0,
	CubeRadius: 12,
	CubeDamage: 100,
	CubeFalloff: BoxerCubeFalloff,
	CubeKnockback: 300,
	CubeLifetime: 5,

	Shotgun:
	{
		Damage: 10,
		HeadshotMultiplier: 1,
		Range: 2048,
		Spread: 6,
		Pellets: 8,
		bPierces: false,
		Falloff: BeamerShotgunFalloff,
		Knockback: 300,
		SelfKnockback: 150,
		bBloodSplatter: false,
		bHeldBeam: false,
		BeamTemplate: "boxer_shot_tracer_template",
		BeamEndName: "boxer_shot_tracer_end",
		BeamLifetime: 0.06,
		ImpactTemplate: "",
		ImpactLifetime: 0,
	},
};

// Boxer ///////////////////////////////////////////////////////////////////////////////////////////

export class BoxerClass extends PlayerClass<FBoxerSettings>
{
	private Cubes: FCube[] = [];

	constructor()
	{
		super(BoxerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		// No model: it's drawn as the debug box it hits things with
		const Projectile: FProjectile = LaunchProjectile(Pawn, this.Settings.CubeSpeed, 0, this.Settings.CubeGravityScale, undefined, this.Settings.CubeRadius, EProjectileShape.Box);
		this.Cubes.push({ ...Projectile, HitPlayers: new Set<CSPlayerPawn>() });
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.Shotgun, Pawn.FindWeapon(this.Settings.Secondary));
	}

	public override TickWorld(Now: number, DeltaTime: number): void
	{
		this.Cubes = this.Cubes.filter((Cube: FCube): boolean =>
		{
			return this.StepCube(Cube, Now, DeltaTime);
		});
	}

	public override OnRoundStart(): void
	{
		DestroyProjectiles(this.Cubes);
		this.Cubes = [];
	}

	private StepCube(Cube: FCube, Now: number, DeltaTime: number): boolean
	{
		if (IsProjectileExpired(Cube, Now, this.Settings.CubeLifetime))
		{
			DestroyProjectile(Cube);
			return false;
		}

		const Step: FPiercingStep = MovePiercingProjectile(Cube, DeltaTime);
		for (const Hit of Step.NewHits)
		{
			this.CubeHitPlayer(Cube, Hit);
		}
		if (Step.WorldHit)
		{
			DestroyProjectile(Cube);
			return false;
		}

		DrawMissingProjectile(Cube);
		return true;
	}

	private CubeHitPlayer(Cube: FCube, Hit: FHitscanHit): void
	{
		const Boxer: CSPlayerPawn = Cube.Owner;
		const Victim: CSPlayerPawn = Hit.Victim;
		if (IsTeammate(Victim, Boxer))
		{
			return;
		}

		const Distance: number = VectorMath.Size(VectorMath.Subtract(Hit.Trace.end, Cube.Start));
		const RangeScale: number = EvaluateDamageCurve(this.Settings.CubeFalloff, Distance);
		const Damage: number = this.Settings.CubeDamage * RangeScale;
		ApplyKnockback(Victim, Cube.Velocity, Damage, this.Settings.CubeKnockback, false);
		if (DealShockDamage(Boxer, Victim, Damage, Boxer.FindWeapon(this.Settings.Primary)) > 0)
		{
			SpawnBloodSplatter(Hit.Trace.end, Victim);
		}
		Console.Log(`${LogPrefix} ${GetPawnName(Boxer)} Damaged (cube) ${GetPawnName(Victim)} : ${Math.round(Damage)}d : ${Math.round(Distance)}u x${RangeScale.toFixed(2)}`);
	}
}