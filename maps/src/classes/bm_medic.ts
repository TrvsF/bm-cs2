import { Instance, Console, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, TraceResult } from "cs_script/point_script";
import { TickInterval, LogPrefix, VectorMath, GetTeamColor, GetChestPosition, GetPawnName, GetOrCreate, IsPlayerPawn, IsTeammate, IsKnife, ForEachLivePawn } from "../bm_core";
import type { FVector, FModifyDamageEvent, FModifyDamageResult } from "../bm_core";
import { LaunchProjectile, MoveProjectile, IsProjectileExpired, DrawMissingProjectile, DestroyProjectile, DestroyProjectiles, EvaluateDamageCurve } from "../bm_combat";
import type { FProjectile, FDamageCurve } from "../bm_combat";
import { DamageTracedBuilding } from "../bm_buildings";
import { BeamStartDrop, PlayerClass, DealShockDamage } from "../bm_classes";
import type { FClassSettings, FHudCounter } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FMedicSettings extends FClassSettings
{
	readonly BoltSpeed: number;
	readonly BoltGravityScale: number;
	readonly BoltDamage: number;
	readonly BoltHeal: number;
	readonly BoltRampUp: FDamageCurve;
	readonly BoltLifetime: number;
	readonly BoltStickTime: number;
	readonly Range: number;
	readonly BreakRange: number;
	readonly HealPerSec: number;
	readonly OverhealMult: number;
	readonly OverhealDecayPerSec: number;
	readonly UberSecondsToFill: number;
	readonly UberDuration: number;
}

export interface FBolt extends FProjectile
{
	StuckUntil: number | undefined;
}

interface FMedicPlayerState
{
	HealTarget: CSPlayerPawn | undefined;
	HealAccumulator: number;
	UberCharge: number;
	UberEndTime: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const CrossbowRampUp: FDamageCurve =
[
	{ Distance: 0, Scale: 0.5 },
	{ Distance: 256, Scale: 0.5 },
	{ Distance: 2048, Scale: 1.0 },
];

export const MedicSettings: FMedicSettings =
{
	DisplayName: "Medic",
	PickFxTemplate: "medic_pick_template",
	Primary: "weapon_nova",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 150,
	SizeScale: 0.9,
	Model: "agents/models/otakku/burnice/burnice.vmdl",
	bStartWithMelee: true,
	MeleeDamage: 20,
	PrimaryLauncher:
	{
		FireInterval: 0.2,
		ClipSize: 1,
		ReloadFirstTime: 1.6,
		ReloadEachTime: 0,
		ChargeTime: 0,
		DeployTime: 0.1,
		FireFxTemplate: "crossbow_fire_template",
		ReloadFxTemplate: "crossbow_reload_template",
	},
	SecondaryLauncher: undefined,

	BoltSpeed: 2400,
	BoltGravityScale: 0.2,
	BoltDamage: 75,
	BoltHeal: 150,
	BoltRampUp: CrossbowRampUp,
	BoltLifetime: 5,
	BoltStickTime: 3,

	Range: 450,
	BreakRange: 540,
	HealPerSec: 24,
	OverhealMult: 1.5,
	OverhealDecayPerSec: 3.3,
	UberSecondsToFill: 40,
	UberDuration: 8,
};

const BoltTemplateName: string = "crossbow_bolt_template";

// Medic ///////////////////////////////////////////////////////////////////////////////////////////

export class MedicClass extends PlayerClass<FMedicSettings>
{
	private PlayerStates: Map<number, FMedicPlayerState> = new Map<number, FMedicPlayerState>();
	private DecayAccumulators: Map<number, number> = new Map<number, number>();   // overheal decay, for any player
	private HealedThisTick: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private UberedThisTick: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private UberedPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private GlowingPawns: Set<CSPlayerPawn> = new Set<CSPlayerPawn>();
	private Bolts: FBolt[] = [];

	constructor()
	{
		super(MedicSettings);
	}

	public override OnPrimaryFire(Pawn: CSPlayerPawn, Slot: number, Now: number): void
	{
		const Projectile: FProjectile = LaunchProjectile(Pawn, this.Settings.BoltSpeed, 0, this.Settings.BoltGravityScale, BoltTemplateName);
		this.Bolts.push({ ...Projectile, StuckUntil: undefined });
	}

	public override TickWorld(Now: number, DeltaTime: number): void
	{
		this.HealedThisTick = new Set<CSPlayerPawn>();
		this.UberedThisTick = new Set<CSPlayerPawn>();
		this.Bolts = this.Bolts.filter((Bolt: FBolt): boolean =>
		{
			return this.StepBolt(Bolt, Now, DeltaTime);
		});
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FMedicPlayerState = this.GetPlayerState(Slot);
		const bHoldingMedigun: boolean = IsKnife(Pawn.GetActiveWeapon());
		const bFiring: boolean = bHoldingMedigun && Pawn.IsInputPressed(CSInputs.ATTACK);

		let Target: CSPlayerPawn | undefined = bFiring ? State.HealTarget : undefined;
		if (Target && !this.IsHealTargetValid(Pawn, Target))
		{
			Target = undefined;
		}
		if (bFiring && !Target)
		{
			Target = this.AcquireHealTarget(Pawn);
		}
		State.HealTarget = Target;

		if (Target)
		{
			this.HealedThisTick.add(Target);
			const MaxHealth: number = Target.GetMaxHealth();
			const OverhealCap: number = Math.floor(MaxHealth * this.Settings.OverhealMult);
			const Health: number = Target.GetHealth();
			if (Health < OverhealCap)
			{
				State.HealAccumulator += this.Settings.HealPerSec * DeltaTime;
				const WholeHealth: number = Math.floor(State.HealAccumulator);
				if (WholeHealth > 0)
				{
					Target.SetHealth(Math.min(OverhealCap, Health + WholeHealth));
					State.HealAccumulator -= WholeHealth;
				}
			}
			if (Now >= State.UberEndTime)
			{
				const ChargeRate: number = (100 / this.Settings.UberSecondsToFill) * (Health < MaxHealth ? 1 : 0.5); // slower on topped-up patients
				State.UberCharge = Math.min(100, State.UberCharge + ChargeRate * DeltaTime);
			}
			// Placeholder beam (tools mode only). Swap for an env_beam for real servers.
			Instance.DebugLine(
			{
				start: VectorMath.Subtract(Pawn.GetEyePosition(), BeamStartDrop),
				end: GetChestPosition(Target),
				duration: TickInterval * 2,
				color: GetTeamColor(Pawn),
			});
		}

		if (Now >= State.UberEndTime && State.UberCharge >= 100 && bHoldingMedigun && Pawn.IsInputPressed(CSInputs.ATTACK2))
		{
			State.UberEndTime = Now + this.Settings.UberDuration;
		}

		const bUberActive: boolean = Now < State.UberEndTime;
		if (bUberActive)
		{
			State.UberCharge = (100 * (State.UberEndTime - Now)) / this.Settings.UberDuration;
			this.UberedThisTick.add(Pawn);
			if (Target)
			{
				this.UberedThisTick.add(Target);
			}
		}
	}

	public override TickWorldLate(Now: number, DeltaTime: number): void
	{
		this.TickOverhealDecay(DeltaTime);
		this.UpdateUberGlows();
		this.UberedPawns = this.UberedThisTick;
	}

	public override OnRoundStart(): void
	{
		this.PlayerStates.clear();
		DestroyProjectiles(this.Bolts);
		this.Bolts = [];
	}

	public override ClearPlayer(Slot: number): void
	{
		this.PlayerStates.delete(Slot);
		this.DecayAccumulators.delete(Slot);
	}

	public override GetHealTarget(Slot: number): CSPlayerPawn | undefined
	{
		const Target: CSPlayerPawn | undefined = this.PlayerStates.get(Slot)?.HealTarget;
		return Target && Target.IsValid() && Target.IsAlive() ? Target : undefined;
	}

	public override GetHudCounter(Slot: number): FHudCounter | undefined
	{
		const State: FMedicPlayerState | undefined = this.PlayerStates.get(Slot);
		return { Label: "Über", Count: State ? Math.floor(State.UberCharge) : 0, Max: 100 };
	}

	public override ModifyAnyDamage(Event: FModifyDamageEvent): FModifyDamageResult
	{
		if (this.UberedPawns.has(Event.player))
		{
			return { abort: true };
		}
		return;
	}

	private StepBolt(Bolt: FBolt, Now: number, DeltaTime: number): boolean
	{
		if (Bolt.StuckUntil !== undefined || IsProjectileExpired(Bolt, Now, this.Settings.BoltLifetime))
		{
			if (Bolt.StuckUntil !== undefined && Now < Bolt.StuckUntil)
			{
				return true;
			}
			DestroyProjectile(Bolt);
			return false;
		}

		const Hit: TraceResult | undefined = MoveProjectile(Bolt, DeltaTime, true);
		if (Hit && IsPlayerPawn(Hit.hitEntity))
		{
			DestroyProjectile(Bolt);
			this.BoltHitPlayer(Bolt, Hit.hitEntity);
			return false;
		}
		if (Hit && DamageTracedBuilding(Hit, this.Settings.BoltDamage * this.GetBoltRangeScale(Bolt), Bolt.Owner))
		{
			DestroyProjectile(Bolt);
			return false;
		}
		if (Hit)
		{
			Bolt.StuckUntil = Now + this.Settings.BoltStickTime;
			return Bolt.Models.length > 0;
		}

		DrawMissingProjectile(Bolt);
		return true;
	}

	private GetBoltRangeScale(Bolt: FBolt): number
	{
		return EvaluateDamageCurve(this.Settings.BoltRampUp, VectorMath.Size(VectorMath.Subtract(Bolt.Position, Bolt.Start)));
	}

	private BoltHitPlayer(Bolt: FBolt, Victim: CSPlayerPawn): void
	{
		const Medic: CSPlayerPawn = Bolt.Owner;
		const Distance: number = VectorMath.Size(VectorMath.Subtract(Bolt.Position, Bolt.Start));
		const RangeScale: number = this.GetBoltRangeScale(Bolt);
		const MedicName: string = GetPawnName(Medic);
		const VictimName: string = GetPawnName(Victim);

		if (IsTeammate(Victim, Medic))
		{
			const Health: number = Victim.GetHealth();
			const Healed: number = Math.min(Victim.GetMaxHealth(), Health + Math.round(this.Settings.BoltHeal * RangeScale));
			if (Healed > Health)
			{
				Victim.SetHealth(Healed);
			}
			Console.Log(`${LogPrefix} ${MedicName} Healed (bolt) ${VictimName} : +${Math.max(0, Healed - Health)}h : ${Math.round(Distance)}u x${RangeScale.toFixed(2)}`);
			return;
		}

		const Damage: number = this.Settings.BoltDamage * RangeScale;
		DealShockDamage(Medic, Victim, Damage, Medic.FindWeapon(this.Settings.Primary));
		Console.Log(`${LogPrefix} ${MedicName} Damaged (bolt) ${VictimName} : ${Math.round(Damage)}d : ${Math.round(Distance)}u x${RangeScale.toFixed(2)}`);
	}

	private GetPlayerState(Slot: number): FMedicPlayerState
	{
		return GetOrCreate(this.PlayerStates, Slot, (): FMedicPlayerState =>
		{
			return { HealTarget: undefined, HealAccumulator: 0, UberCharge: 0, UberEndTime: 0 };
		});
	}

	private IsHealTargetValid(Medic: CSPlayerPawn, Target: CSPlayerPawn): boolean
	{
		if (!Target.IsValid() || !Target.IsAlive() || Target.GetTeamNumber() !== Medic.GetTeamNumber())
		{
			return false;
		}
		const EyePosition: FVector = Medic.GetEyePosition();
		const TargetChest: FVector = GetChestPosition(Target);
		if (VectorMath.Size(VectorMath.Subtract(TargetChest, EyePosition)) > this.Settings.BreakRange)
		{
			return false;
		}
		return !Instance.TraceLine({ start: EyePosition, end: TargetChest, ignorePlayers: true }).didHit;
	}

	private AcquireHealTarget(Medic: CSPlayerPawn): CSPlayerPawn | undefined
	{
		const EyePosition: FVector = Medic.GetEyePosition();
		const Forward: FVector = VectorMath.GetForwardVector(Medic.GetEyeAngles());
		const End: FVector = VectorMath.Add(EyePosition, VectorMath.Scale(Forward, this.Settings.Range));
		const HitEntity: Entity | undefined = Instance.TraceSphere({ start: EyePosition, end: End, radius: 12, ignoreEntity: Medic }).hitEntity;
		if (IsPlayerPawn(HitEntity) && HitEntity.IsAlive() && HitEntity.GetTeamNumber() === Medic.GetTeamNumber())
		{
			return HitEntity;
		}
		return undefined;
	}

	private TickOverhealDecay(DeltaTime: number): void
	{
		ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
		{
			const MaxHealth: number = Pawn.GetMaxHealth();
			const Health: number = Pawn.GetHealth();
			if (Health > MaxHealth && !this.HealedThisTick.has(Pawn))
			{
				let Accumulator: number = (this.DecayAccumulators.get(Slot) ?? 0) + this.Settings.OverhealDecayPerSec * DeltaTime;
				const WholeDecay: number = Math.floor(Accumulator);
				if (WholeDecay > 0)
				{
					Pawn.SetHealth(Math.max(MaxHealth, Health - WholeDecay));
					Accumulator -= WholeDecay;
				}
				this.DecayAccumulators.set(Slot, Accumulator);
			}
			else
			{
				this.DecayAccumulators.set(Slot, 0);
			}
		});
	}

	private UpdateUberGlows(): void
	{
		for (const Pawn of this.GlowingPawns)
		{
			if (!this.UberedThisTick.has(Pawn) && Pawn.IsValid())
			{
				Pawn.Unglow();
			}
		}
		for (const Pawn of this.UberedThisTick)
		{
			if (!this.GlowingPawns.has(Pawn))
			{
				Pawn.Glow(GetTeamColor(Pawn));
			}
		}
		this.GlowingPawns = new Set<CSPlayerPawn>(this.UberedThisTick);
	}
}