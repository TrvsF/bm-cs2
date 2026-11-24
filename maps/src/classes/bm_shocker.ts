import { Instance, Console } from "cs_script/point_script";
import type { CSPlayerPawn, TraceResult } from "cs_script/point_script";
import { LogPrefix, VectorMath, GetPawnName, GetTeamColor, IsPlayerPawn, IsTeammate, GetChestPosition, ForEachLivePawn } from "../bm_core";
import type { FVector } from "../bm_core";
import { LaunchProjectile, MoveProjectile, SinkProjectile, IsProjectileExpired, DrawMissingProjectile, DestroyProjectile, DestroyProjectiles, MakeShootable, Explode, SetProjectileLit, IsBlinkOn } from "../bm_combat";
import type { FProjectile } from "../bm_combat";
import { GetTraceBuilding } from "../bm_buildings";
import { PlayerClass, FireHitscanWeapon, GetHitscanBotShot, GetProjectileBotShot } from "../bm_classes";
import type { FClassSettings, FHitscanWeaponSettings, FBotShot, FBotTrickShot } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FShockerSettings extends FClassSettings
{
	readonly ShockBeam: FHitscanWeaponSettings;
	readonly BallSpeed: number;
	readonly BallSize: number;
	readonly BallDamage: number;
	readonly BallDirectHitScale: number;
	readonly BallRadius: number;
	readonly BallKnockback: number;
	readonly BallLifetime: number;
	readonly BallStuckLifetime: number;
	readonly BallStickDepth: number;
	readonly BallStickMaxDistance: number;
	readonly BallStuckHitRadius: number;
	readonly BallWeight: number;
	readonly BallKnockedGravityScale: number;
	readonly BallLightOnTime: number;
	readonly BallLightPeriod: number;
	readonly BallFxTemplate: string;
	readonly ComboDamage: number;
	readonly ComboRadius: number;
	readonly ComboKnockback: number;
	readonly ComboFxTemplate: string;
}

export interface FShockBall extends FProjectile
{
	StuckAt: number | undefined;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const ShockerSettings: FShockerSettings =
{
	DisplayName: "Shocker",
	PickFxTemplate: "shocker_pick_template",
	Primary: "weapon_m4a1",
	Secondary: "weapon_p250",
	Melee: "",
	Health: 125,
	SizeScale: 1.1,
	Model: "agents/models/otakku/agent_smith/agent_smith.vmdl",
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
	BallDirectHitScale: 1.2,
	BallRadius: 80,
	BallKnockback: 500,
	BallLifetime: 5,
	BallStuckLifetime: 6,
	BallStickDepth: 16,
	BallStickMaxDistance: 128,
	BallStuckHitRadius: 16,
	BallWeight: 0.5,
	BallKnockedGravityScale: 1,
	BallLightOnTime: 0.15,
	BallLightPeriod: 1,
	BallFxTemplate: "shock_ball_explode_template",

	ComboDamage: 125,
	ComboRadius: 240,
	ComboKnockback: 300,
	ComboFxTemplate: "shock_combo_template",
};

const ShockBallTemplateName: string = "shock_ball_template";

// Shocker /////////////////////////////////////////////////////////////////////////////////////////

const BotComboTriggerScale: number = 0.6;

export class ShockerClass extends PlayerClass<FShockerSettings>
{
	private Balls: FShockBall[] = [];

	constructor()
	{
		super(ShockerSettings);
	}

	public override GetBotShot(WeaponName: string): FBotShot | undefined
	{
		return WeaponName === this.Settings.Primary
			? GetProjectileBotShot(this.Settings.BallDamage, this.Settings.BallRadius, { Speed: this.Settings.BallSpeed, UpSpeed: 0, GravityScale: 0 })
			: GetHitscanBotShot(this.Settings.ShockBeam);
	}

	// A bot shoots one of its own balls with the beam once the combo would catch an enemy and not itself
	public override GetBotTrickShot(Pawn: CSPlayerPawn, Now: number): FBotTrickShot | undefined
	{
		const Eye: FVector = Pawn.GetEyePosition();
		const Reach: number = this.Settings.ComboRadius * BotComboTriggerScale;
		for (const Ball of this.Balls)
		{
			if (Ball.Owner !== Pawn || VectorMath.Size(VectorMath.Subtract(Ball.Position, Eye)) <= this.Settings.ComboRadius)
			{
				continue;
			}
			let bEnemyNear: boolean = false;
			ForEachLivePawn((Other: CSPlayerPawn): void =>
			{
				bEnemyNear ||= Other !== Pawn && !IsTeammate(Other, Pawn) && VectorMath.Size(VectorMath.Subtract(GetChestPosition(Other), Ball.Position)) <= Reach;
			});
			const Sight: TraceResult | undefined = bEnemyNear ? Instance.TraceLine({ start: Eye, end: Ball.Position, ignorePlayers: true }) : undefined;
			if (Sight && (!Sight.didHit || VectorMath.Size(VectorMath.Subtract(Sight.end, Ball.Position)) <= this.Settings.BallStuckHitRadius))
			{
				return { WeaponName: this.Settings.Secondary, Spot: Ball.Position };
			}
		}
		return undefined;
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Ball: FShockBall = { ...LaunchProjectile(Pawn, this.Settings.BallSpeed, 0, 0, ShockBallTemplateName, this.Settings.BallSize), StuckAt: undefined };
		this.Balls.push(Ball);
		MakeShootable(Ball, this.Settings.BallStuckHitRadius, this.Settings.BallWeight, (Push: FVector): void =>
		{
			this.KnockBall(Ball, Push);
		});
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
			return this.StepBall(Ball, Now, DeltaTime);
		});
	}

	public override OnRoundStart(): void
	{
		DestroyProjectiles(this.Balls);
		this.Balls = [];
	}

	private StepBall(Ball: FShockBall, Now: number, DeltaTime: number): boolean
	{
		if (Ball.bDestroyed)
		{
			return false;
		}
		if (Ball.Owner.IsValid())
		{
			SetProjectileLit(Ball, IsBlinkOn(Now - Ball.SpawnedAt, this.Settings.BallLightOnTime, this.Settings.BallLightPeriod), GetTeamColor(Ball.Owner));
		}
		if (Ball.StuckAt !== undefined)
		{
			if (!Ball.Owner.IsValid() || Now - Ball.StuckAt >= this.Settings.BallStuckLifetime)
			{
				this.ExplodeBall(Ball);
				return false;
			}
			if (Ball.Models.length === 0)
			{
				DrawMissingProjectile(Ball);
			}
			return true;
		}

		if (IsProjectileExpired(Ball, Now, this.Settings.BallLifetime))
		{
			DestroyProjectile(Ball);
			return false;
		}
		const Hit: TraceResult | undefined = MoveProjectile(Ball, DeltaTime, true);
		if (!Hit)
		{
			DrawMissingProjectile(Ball);
			return true;
		}
		if (!GetTraceBuilding(Hit) && (Hit.hitEntity === undefined || Hit.hitEntity.IsWorld()))
		{
			SinkProjectile(Ball, Hit, this.Settings.BallStickDepth, this.Settings.BallStickMaxDistance);
			Ball.StuckAt = Now;
			return true;
		}
		this.ExplodeBall(Ball, IsPlayerPawn(Hit.hitEntity) ? Hit.hitEntity : undefined);
		return false;
	}

	private KnockBall(Ball: FShockBall, Push: FVector): void
	{
		if (Ball.StuckAt !== undefined)
		{
			Ball.StuckAt = undefined;
			Ball.SpawnedAt = Instance.GetGameTime();
		}
		Ball.Velocity = VectorMath.Add(Ball.Velocity, Push);
		Ball.GravityScale = this.Settings.BallKnockedGravityScale;
	}

	private ExplodeBall(Ball: FShockBall, Struck: CSPlayerPawn | undefined = undefined): void
	{
		DestroyProjectile(Ball);
		Explode(Ball.Position, Ball.Owner, this.Settings.BallRadius, this.Settings.BallDamage, this.Settings.BallKnockback, undefined, this.Settings.BallFxTemplate, Struck, this.Settings.BallDirectHitScale);
	}

	private DetonateBallOnBeam(Shooter: CSPlayerPawn, Start: FVector, End: FVector): FVector | undefined
	{
		let Combo: FShockBall | undefined = undefined;
		let ComboDistance: number = Infinity;
		for (const Ball of this.Balls)
		{
			const Closest: FVector = VectorMath.ClosestPointOnSegment(Ball.Position, Start, End);
			const Distance: number = VectorMath.Size(VectorMath.Subtract(Closest, Start));
			const HitRadius: number = Ball.StuckAt !== undefined ? this.Settings.BallStuckHitRadius : Ball.Radius;
			if (Ball.Owner === Shooter && VectorMath.Size(VectorMath.Subtract(Ball.Position, Closest)) <= HitRadius && Distance < ComboDistance)
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