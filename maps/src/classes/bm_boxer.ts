import { Console } from "cs_script/point_script";
import type { CSPlayerPawn } from "cs_script/point_script";
import { LogPrefix, VectorMath, GetPawnName, GetTeamColor, IsTeammate } from "../bm_core";
import type { FVector, FColor } from "../bm_core";
import { EProjectileShape, LaunchProjectile, MovePiercingProjectile, MovePhasedProjectile, IsProjectileExpired, DrawMissingProjectile, DestroyProjectile, DestroyProjectiles, TintProjectile, LightProjectile, SetProjectileLit, EvaluateDamageCurve, ApplyKnockback } from "../bm_combat";
import type { FProjectile, FPiercingProjectile, FPiercingStep, FPhasedHit, FDamageCurve } from "../bm_combat";
import { GetTraceBuilding, DamageTracedBuilding } from "../bm_buildings";
import { SpawnBloodSplatter } from "../bm_effects";
import { TF2HitscanFalloff, PlayerClass, FireHitscanWeapon, DealShockDamage, GetHitscanBotShot, GetProjectileBotShot } from "../bm_classes";
import type { FClassSettings, FHitscanWeaponSettings, FBotShot } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FBoxerSettings extends FClassSettings
{
	readonly CubeSpeed: number;
	readonly CubeGravityScale: number;
	readonly CubeRadius: number;
	readonly CubeDamage: number;
	readonly CubeFalloff: FDamageCurve;
	readonly CubeKnockback: number;
	readonly CubeLifetime: number;
	// A cube goes on through walls. Once it has, its team colour is darkened to CubeThroughWallShade and its damage is multiplied by CubeThroughWallDamageScale.
	readonly CubeThroughWallDamageScale: number;
	readonly CubeThroughWallShade: number;
	readonly Shotgun: FHitscanWeaponSettings;
}

export interface FCube extends FPiercingProjectile
{
	bThroughWall: boolean;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const BoxerCubeFalloff: FDamageCurve =
[
	{ Distance: 0, Scale: 1.0 },
	{ Distance: 512, Scale: 0.75 },
	{ Distance: 2048, Scale: 0.5 },
];

export const BoxerSettings: FBoxerSettings =
{
	DisplayName: "Cuber",
	PickFxTemplate: "boxer_pick_template",
	Primary: "weapon_m249",
	Secondary: "weapon_deagle",
	Melee: "",
	Health: 180,
	SizeScale: 1.25,
	Model: "agents/models/otakku/rochelle/rochelle.vmdl",
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

	CubeSpeed: 800,
	CubeGravityScale: 0,
	CubeRadius: 12,
	CubeDamage: 150,
	CubeFalloff: BoxerCubeFalloff,
	CubeKnockback: 300,
	CubeLifetime: 5,
	CubeThroughWallDamageScale: 0.5,
	CubeThroughWallShade: 0.5,

	Shotgun:
	{
		Damage: 8,
		HeadshotMultiplier: 1,
		Range: 2048,
		Spread: 6,
		Pellets: 8,
		bPierces: false,
		Falloff: TF2HitscanFalloff,
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

const CubeTemplateName: string = "cube_template";

// Boxer ///////////////////////////////////////////////////////////////////////////////////////////

export class BoxerClass extends PlayerClass<FBoxerSettings>
{
	private Cubes: FCube[] = [];

	constructor()
	{
		super(BoxerSettings);
	}

	public override GetBotShot(WeaponName: string): FBotShot | undefined
	{
		return WeaponName === this.Settings.Primary
			? GetProjectileBotShot(this.Settings.CubeDamage, this.Settings.CubeRadius, { Speed: this.Settings.CubeSpeed, UpSpeed: 0, GravityScale: this.Settings.CubeGravityScale }, this.Settings.CubeFalloff)
			: GetHitscanBotShot(this.Settings.Shotgun);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Projectile: FProjectile = LaunchProjectile(Pawn, this.Settings.CubeSpeed, 0, this.Settings.CubeGravityScale, CubeTemplateName, this.Settings.CubeRadius, EProjectileShape.Box);
		SetProjectileLit(Projectile, true, GetTeamColor(Pawn));
		this.Cubes.push({ ...Projectile, HitPlayers: new Set<CSPlayerPawn>(), bThroughWall: false });
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

		if (Cube.bThroughWall)
		{
			// Walls no longer stop it, so they no longer hide anyone from it either
			const Hits: FPhasedHit[] = MovePhasedProjectile(Cube, DeltaTime);
			for (const Hit of Hits)
			{
				this.CubeHitPlayer(Cube, Hit.Victim, Hit.Point);
			}
			DrawMissingProjectile(Cube);
			return true;
		}

		const Step: FPiercingStep = MovePiercingProjectile(Cube, DeltaTime);
		for (const Hit of Step.NewHits)
		{
			this.CubeHitPlayer(Cube, Hit.Victim, Hit.Trace.end);
		}
		if (Step.WorldHit && GetTraceBuilding(Step.WorldHit))
		{
			DamageTracedBuilding(Step.WorldHit, this.GetCubeDamage(Cube, Cube.Position), Cube.Owner);
			DestroyProjectile(Cube);
			return false;
		}
		if (Step.WorldHit)
		{
			Cube.bThroughWall = true;
			const Team: FColor = GetTeamColor(Cube.Owner);
			const Shade: number = this.Settings.CubeThroughWallShade;
			const Dark: FColor = { r: Math.round(Team.r * Shade), g: Math.round(Team.g * Shade), b: Math.round(Team.b * Shade) };
			TintProjectile(Cube, Dark);
			LightProjectile(Cube, Dark);
		}

		DrawMissingProjectile(Cube);
		return true;
	}

	private GetCubeDamage(Cube: FCube, Point: FVector): number
	{
		const Distance: number = VectorMath.Size(VectorMath.Subtract(Point, Cube.Start));
		const WallScale: number = Cube.bThroughWall ? this.Settings.CubeThroughWallDamageScale : 1;
		return this.Settings.CubeDamage * EvaluateDamageCurve(this.Settings.CubeFalloff, Distance) * WallScale;
	}

	private CubeHitPlayer(Cube: FCube, Victim: CSPlayerPawn, Point: FVector): void
	{
		const Boxer: CSPlayerPawn = Cube.Owner;
		if (IsTeammate(Victim, Boxer))
		{
			return;
		}

		const Damage: number = this.GetCubeDamage(Cube, Point);
		ApplyKnockback(Victim, Cube.Velocity, Damage, this.Settings.CubeKnockback, false);
		if (DealShockDamage(Boxer, Victim, Damage, Boxer.FindWeapon(this.Settings.Primary)) > 0)
		{
			SpawnBloodSplatter(Point, Victim);
		}
		Console.Log(`${LogPrefix} ${GetPawnName(Boxer)} Damaged (cube${Cube.bThroughWall ? ", through a wall" : ""}) ${GetPawnName(Victim)} : ${Math.round(Damage)}d`);
	}
}