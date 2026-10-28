import { Console } from "cs_script/point_script";
import type { CSPlayerPawn } from "cs_script/point_script";
import { LogPrefix, VectorMath, GetPawnName } from "../bm_core";
import type { FVector } from "../bm_core";
import { LaunchProjectile, StepImpactProjectile, DestroyProjectile, DestroyProjectiles, Explode } from "../bm_combat";
import type { FProjectile } from "../bm_combat";
import { PlayerClass, FireHitscanWeapon } from "../bm_classes";
import type { FClassSettings, FHitscanWeaponSettings } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FShockerSettings extends FClassSettings
{
	readonly ShockBeam: FHitscanWeaponSettings;
	readonly BallSpeed: number;
	readonly BallSize: number;
	readonly BallDamage: number;
	readonly BallRadius: number;
	readonly BallKnockback: number;
	readonly BallLifetime: number;
	readonly BallFxTemplate: string;
	readonly ComboDamage: number;
	readonly ComboRadius: number;
	readonly ComboKnockback: number;
	readonly ComboFxTemplate: string;
}

export interface FShockBall extends FProjectile
{
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const ShockerSettings: FShockerSettings =
{
	DisplayName: "Shocker",
	PickFxTemplate: "shocker_pick_template",
	Primary: "weapon_m4a1",
	Secondary: "weapon_p250",
	Melee: "weapon_knife",
	Health: 125,
	SizeScale: 1.1,
	PrimaryLauncher:
	{
		FireInterval: 0.5,
		ClipSize: 3,
		ReloadFirstTime: 1.0,
		ReloadEachTime: 0.4,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "shock_ball_fire_template",
		ReloadFxTemplate: "shock_reload_template",
	},
	SecondaryLauncher:
	{
		FireInterval: 0.4,
		ClipSize: 5,
		ReloadFirstTime: 1.6,
		ReloadEachTime: 0,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "shock_beam_fire_template",
		ReloadFxTemplate: "shock_reload_template",
	},

	ShockBeam:
	{
		Damage: 33,
		HeadshotMultiplier: 1,
		Range: 8192,
		Spread: 0,
		Pellets: 1,
		bPierces: false,
		Falloff: [],
		Knockback: 250,
		SelfKnockback: 0,
		bBloodSplatter: false,
		bHeldBeam: false,
		BeamTemplate: "shock_beam_template",
		BeamEndName: "shock_beam_end",
		BeamLifetime: 0.3,
		ImpactTemplate: "shock_impact_template",
		ImpactLifetime: 1,
	},

	BallSpeed: 1000,
	BallSize: 16,
	BallDamage: 50,
	BallRadius: 80,
	BallKnockback: 500,
	BallLifetime: 5,
	BallFxTemplate: "shock_ball_explode_template",

	ComboDamage: 160,
	ComboRadius: 240,
	ComboKnockback: 900,
	ComboFxTemplate: "shock_combo_template",
};

const ShockBallTemplateName: string = "shock_ball_template";

// Shocker /////////////////////////////////////////////////////////////////////////////////////////

export class ShockerClass extends PlayerClass<FShockerSettings>
{
	private Balls: FShockBall[] = [];

	constructor()
	{
		super(ShockerSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		this.Balls.push(LaunchProjectile(Pawn, this.Settings.BallSpeed, 0, 0, ShockBallTemplateName, this.Settings.BallSize));
	}

	public override OnSecondaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		FireHitscanWeapon(Pawn, this.Settings.ShockBeam, Pawn.FindWeapon(this.Settings.Secondary), (Start: FVector, End: FVector): FVector | undefined =>
		{
			return this.DetonateBallOnBeam(Pawn, Start, End);
		});
	}

	public override TickWorld(Now: number, DeltaTime: number): void
	{
		this.Balls = this.Balls.filter((Ball: FShockBall): boolean =>
		{
			return StepImpactProjectile(Ball, Now, DeltaTime, this.Settings.BallLifetime, (): void =>
			{
				Explode(Ball.Position, Ball.Owner, this.Settings.BallRadius, this.Settings.BallDamage, this.Settings.BallKnockback, undefined, this.Settings.BallFxTemplate);
			});
		});
	}

	public override OnRoundStart(): void
	{
		DestroyProjectiles(this.Balls);
		this.Balls = [];
	}

	private DetonateBallOnBeam(Shooter: CSPlayerPawn, Start: FVector, End: FVector): FVector | undefined
	{
		let Combo: FShockBall | undefined = undefined;
		let ComboDistance: number = Infinity;
		for (const Ball of this.Balls)
		{
			const Closest: FVector = VectorMath.ClosestPointOnSegment(Ball.Position, Start, End);
			const Distance: number = VectorMath.Size(VectorMath.Subtract(Closest, Start));
			if (Ball.Owner === Shooter && VectorMath.Size(VectorMath.Subtract(Ball.Position, Closest)) <= Ball.Radius && Distance < ComboDistance)
			{
				Combo = Ball;
				ComboDistance = Distance;
			}
		}
		if (!Combo)
		{
			return undefined;
		}

		const Detonated: FShockBall = Combo;
		this.Balls = this.Balls.filter((Ball: FShockBall): boolean =>
		{
			return Ball !== Detonated;
		});
		DestroyProjectile(Detonated);
		Explode(Detonated.Position, Shooter, this.Settings.ComboRadius, this.Settings.ComboDamage, this.Settings.ComboKnockback, undefined, this.Settings.ComboFxTemplate);
		Console.Log(`${LogPrefix} ${GetPawnName(Shooter)} shock combo, ${Math.round(VectorMath.Size(VectorMath.Subtract(Detonated.Position, Detonated.Start)))}u from where the ball was fired`);
		return Detonated.Position;
	}
}