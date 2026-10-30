import { Instance, Console, CSInputs } from "cs_script/point_script";
import type { CSPlayerPawn } from "cs_script/point_script";
import { TickInterval, LogPrefix, ZeroVector, VectorMath, GetPawnName, GetTeamColor, GetOrCreate, IsKnife, IsWeapon, ConsumePress, ForEachLivePawn } from "../bm_core";
import type { FVector, FColor, FHeldInputs } from "../bm_core";
import { Explode } from "../bm_combat";
import { SpawnTemporaryTemplate } from "../bm_effects";
import { BuildingKind, FindOwnedBuilding, IsBuildingEnemy, IsStandingOn, GetBuildingCenter, TickBuildTool, CancelPlacement, RemoveBuilding, DestroyBuilding } from "../bm_buildings";
import type { FBuilding, FBuildingSettings, FBuildKeys } from "../bm_buildings";
import { PlayerClass } from "../bm_classes";
import type { FClassSettings, FHudCounter } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FTrapSettings extends FBuildingSettings
{
	readonly ArmTime: number;
	readonly TriggerReach: number;
	readonly TriggerHeight: number;
	readonly Damage: number;
	readonly BlastRadius: number;
	readonly BlastHeight: number;
	readonly Knockback: number;
	readonly ExplodeFxTemplate: string;
}

export interface FTeleporterSettings extends FBuildingSettings
{
	readonly RechargeTime: number;
	readonly RechargeColor: FColor;
	readonly StandHeight: number;
	readonly TeleportFxTemplate: string;
}

export interface FShrinkerSettings extends FClassSettings
{
	readonly ShrunkScale: number;
	readonly ShrinkTime: number;
	readonly GrowTime: number;
	readonly ShrunkDuration: number;
	readonly RechargeTime: number;
	readonly MinShrinkCharge: number;
	readonly Trap: FTrapSettings;
	readonly TeleporterEntrance: FTeleporterSettings;
	readonly TeleporterExit: FTeleporterSettings;
}

interface FTrapState
{
	ArmedAt: number;
}

interface FTeleporterState
{
	ReadyAt: number;
}

interface FShrinkerPlayerState
{
	Charge: number;
	bWantsShrunk: boolean;
	ShrinkAlpha: number;
	Held: FHeldInputs;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const ShrinkerSettings: FShrinkerSettings =
{
	DisplayName: "Shrinker",
	PickFxTemplate: "shrinker_pick_template",
	Primary: "weapon_glock",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 100,
	SizeScale: 1.0,
	Model: "agents/models/otakku/perry_the_platypus/perry_the_platypus.vmdl",
	bStartWithMelee: true,
	RepairPerHit: 25,
	PrimaryLauncher: undefined,
	SecondaryLauncher: undefined,

	ShrunkScale: 0.33,
	ShrinkTime: 0.75,
	GrowTime: 0.75,
	ShrunkDuration: 10,
	RechargeTime: 16,
	MinShrinkCharge: 10,

	Trap:
	{
		DisplayName: "Trap",
		ModelTemplate: "shrinker_trap_template",
		PreviewTemplate: "shrinker_trap_preview_template",
		DestroyFxTemplate: "shrinker_building_destroy_template",
		Health: 25,
		HalfWidth: 16,
		Height: 8,
		ThrowSpeed: 500,
		MaxCount: 2,
		RebuildDelay: 10,
		ArmTime: 1.5,
		TriggerReach: 28,
		TriggerHeight: 24,
		Damage: 150,
		BlastRadius: 120,
		BlastHeight: 24,
		Knockback: 300,
		ExplodeFxTemplate: "shrinker_trap_explode_template",
	},

	TeleporterEntrance:
	{
		DisplayName: "Teleporter Entrance",
		ModelTemplate: "shrinker_teleporter_entrance_template",
		PreviewTemplate: "shrinker_teleporter_preview_template",
		DestroyFxTemplate: "shrinker_building_destroy_template",
		Health: 60,
		HalfWidth: 24,
		Height: 12,
		ThrowSpeed: 450,
		MaxCount: 1,
		RebuildDelay: 10,
		RechargeTime: 5,
		RechargeColor: { r: 110, g: 110, b: 110 },
		StandHeight: 40,
		TeleportFxTemplate: "shrinker_teleport_template",
	},

	TeleporterExit:
	{
		DisplayName: "Teleporter Exit",
		ModelTemplate: "shrinker_teleporter_exit_template",
		PreviewTemplate: "shrinker_teleporter_preview_template",
		DestroyFxTemplate: "shrinker_building_destroy_template",
		Health: 60,
		HalfWidth: 24,
		Height: 12,
		ThrowSpeed: 450,
		MaxCount: 1,
		RebuildDelay: 10,
		RechargeTime: 5,
		RechargeColor: { r: 110, g: 110, b: 110 },
		StandHeight: 40,
		TeleportFxTemplate: "shrinker_teleport_template",
	},
};

const MaxShrinkCharge: number = 100;
const TeleportFxLifetime: number = 3;
const ArrivalLift: number = 2;

// Trap ////////////////////////////////////////////////////////////////////////////////////////////

export class TrapKind extends BuildingKind<FTrapSettings>
{
	private States: Map<FBuilding, FTrapState> = new Map<FBuilding, FTrapState>();

	public override OnPlaced(Building: FBuilding, Now: number): void
	{
		this.States.set(Building, { ArmedAt: Now + this.Settings.ArmTime });
	}

	public override OnRemoved(Building: FBuilding): void
	{
		this.States.delete(Building);
	}

	public override Tick(Building: FBuilding, Now: number, DeltaTime: number): void
	{
		const State: FTrapState | undefined = this.States.get(Building);
		const Victim: CSPlayerPawn | undefined = State && Now >= State.ArmedAt ? this.FindVictim(Building) : undefined;
		if (!Victim)
		{
			return;
		}
		const Origin: FVector = VectorMath.Add(Building.Position, { x: 0, y: 0, z: this.Settings.BlastHeight });
		Console.Log(`${LogPrefix} ${GetPawnName(Victim)} set off ${GetPawnName(Building.Owner)}'s ${this.Settings.DisplayName}`);
		Building.DamageDealt += Explode(Origin, Building.Owner, this.Settings.BlastRadius, this.Settings.Damage, this.Settings.Knockback, undefined, this.Settings.ExplodeFxTemplate);
		RemoveBuilding(Building);
	}

	public override GetStatus(Building: FBuilding, Now: number): string
	{
		const State: FTrapState | undefined = this.States.get(Building);
		return State && Now < State.ArmedAt ? "Arming" : "Armed";
	}

	private FindVictim(Building: FBuilding): CSPlayerPawn | undefined
	{
		let Victim: CSPlayerPawn | undefined = undefined;
		ForEachLivePawn((Pawn: CSPlayerPawn): void =>
		{
			if (!Victim && IsBuildingEnemy(Building, Pawn) && IsStandingOn(Building, Pawn, this.Settings.TriggerReach, this.Settings.TriggerHeight))
			{
				Victim = Pawn;
			}
		});
		return Victim;
	}
}

// Teleporter //////////////////////////////////////////////////////////////////////////////////////

export class TeleporterKind extends BuildingKind<FTeleporterSettings>
{
	public Partner: TeleporterKind | undefined = undefined;
	private readonly bEntrance: boolean;
	private States: Map<FBuilding, FTeleporterState> = new Map<FBuilding, FTeleporterState>();

	constructor(Settings: FTeleporterSettings, bEntrance: boolean)
	{
		super(Settings);
		this.bEntrance = bEntrance;
	}

	public override OnPlaced(Building: FBuilding, Now: number): void
	{
		this.States.set(Building, { ReadyAt: Now });
	}

	public override OnRemoved(Building: FBuilding): void
	{
		this.States.delete(Building);
	}

	public override OnDestroyed(Building: FBuilding): void
	{
		const Other: FBuilding | undefined = this.FindPartner(Building);
		if (Other)
		{
			DestroyBuilding(Other);
		}
	}

	public override Tick(Building: FBuilding, Now: number, DeltaTime: number): void
	{
		const Exit: FBuilding | undefined = this.FindPartner(Building);
		const State: FTeleporterState | undefined = this.States.get(Building);
		if (!this.bEntrance || !Exit || !State)
		{
			return;
		}
		Instance.DebugLine({ start: GetBuildingCenter(Building), end: GetBuildingCenter(Exit), duration: TickInterval * 2, color: GetTeamColor(Building.Owner) });
		if (Now < State.ReadyAt)
		{
			return;
		}
		const Traveller: CSPlayerPawn | undefined = this.FindTraveller(Building);
		if (Traveller)
		{
			this.Send(Traveller, Building, Exit);
			State.ReadyAt = Now + this.Settings.RechargeTime;
		}
	}

	public override GetColor(Building: FBuilding, Now: number): FColor | undefined
	{
		return this.IsRecharging(Building, Now) ? this.Settings.RechargeColor : undefined;
	}

	public override GetStatus(Building: FBuilding, Now: number): string
	{
		if (!this.FindPartner(Building))
		{
			return this.bEntrance ? "Needs exit" : "Needs entrance";
		}
		return this.IsRecharging(Building, Now) ? "Recharging" : "Ready";
	}

	// Both ends count as recharging after a trip, since the wait is kept on the entrance
	private IsRecharging(Building: FBuilding, Now: number): boolean
	{
		const Entrance: FBuilding | undefined = this.bEntrance ? Building : this.FindPartner(Building);
		const EntranceKind: TeleporterKind | undefined = this.bEntrance ? this : this.Partner;
		const State: FTeleporterState | undefined = Entrance && EntranceKind ? EntranceKind.States.get(Entrance) : undefined;
		return State !== undefined && Now < State.ReadyAt;
	}

	private FindPartner(Building: FBuilding): FBuilding | undefined
	{
		return this.Partner ? FindOwnedBuilding(Building.OwnerSlot, this.Partner) : undefined;
	}

	private FindTraveller(Building: FBuilding): CSPlayerPawn | undefined
	{
		let Traveller: CSPlayerPawn | undefined = undefined;
		ForEachLivePawn((Pawn: CSPlayerPawn): void =>
		{
			if (!Traveller && !IsBuildingEnemy(Building, Pawn) && IsStandingOn(Building, Pawn, this.Settings.HalfWidth, this.Settings.StandHeight))
			{
				Traveller = Pawn;
			}
		});
		return Traveller;
	}

	private Send(Traveller: CSPlayerPawn, Entrance: FBuilding, Exit: FBuilding): void
	{
		const Arrival: FVector = VectorMath.Add(Exit.Position, { x: 0, y: 0, z: Exit.Kind.Settings.Height + ArrivalLift });
		SpawnTemporaryTemplate(this.Settings.TeleportFxTemplate, GetBuildingCenter(Entrance), TeleportFxLifetime);
		SpawnTemporaryTemplate(this.Settings.TeleportFxTemplate, Arrival, TeleportFxLifetime);
		Traveller.Teleport({ position: Arrival, angles: { pitch: 0, yaw: Exit.Yaw, roll: 0 }, velocity: ZeroVector });
		Traveller.SetEyeAngles({ pitch: Traveller.GetEyeAngles().pitch, yaw: Exit.Yaw, roll: 0 });
		Console.Log(`${LogPrefix} ${GetPawnName(Traveller)} took ${GetPawnName(Entrance.Owner)}'s teleporter`);
	}
}

// Shrinker ////////////////////////////////////////////////////////////////////////////////////////

export class ShrinkerClass extends PlayerClass<FShrinkerSettings>
{
	private readonly Trap: TrapKind = new TrapKind(ShrinkerSettings.Trap);
	private readonly Entrance: TeleporterKind = new TeleporterKind(ShrinkerSettings.TeleporterEntrance, true);
	private readonly Exit: TeleporterKind = new TeleporterKind(ShrinkerSettings.TeleporterExit, false);
	private readonly BuildKeys: FBuildKeys = { Left: { Label: "Traps", Kinds: [this.Trap] }, Right: { Label: "Teleporters", Kinds: [this.Entrance, this.Exit] } };
	private PlayerStates: Map<number, FShrinkerPlayerState> = new Map<number, FShrinkerPlayerState>();

	constructor()
	{
		super(ShrinkerSettings);
		this.Entrance.Partner = this.Exit;
		this.Exit.Partner = this.Entrance;
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FShrinkerPlayerState = this.GetPlayerState(Slot);
		const bLeftPressed: boolean = ConsumePress(Pawn, State.Held, CSInputs.ATTACK);
		const bRightPressed: boolean = ConsumePress(Pawn, State.Held, CSInputs.ATTACK2);
		TickBuildTool(Pawn, Slot, this.GetBuildKeys(Pawn), bLeftPressed, bRightPressed, Now);

		if (bRightPressed && IsKnife(Pawn.GetActiveWeapon()))
		{
			this.ToggleShrink(State);
		}
		this.TickCharge(State, DeltaTime);
		this.TickSize(Pawn, State, DeltaTime);
	}

	public override GetBuildKeys(Pawn: CSPlayerPawn): FBuildKeys | undefined
	{
		return IsWeapon(Pawn.GetActiveWeapon(), this.Settings.Primary) ? this.BuildKeys : undefined;
	}

	public override ClearPlayer(Slot: number): void
	{
		CancelPlacement(Slot);
		this.PlayerStates.delete(Slot);
	}

	public override GetHudCounter(Slot: number): FHudCounter | undefined
	{
		const State: FShrinkerPlayerState | undefined = this.PlayerStates.get(Slot);
		return { Label: "Shrink", Count: Math.floor(State ? State.Charge : MaxShrinkCharge), Max: MaxShrinkCharge };
	}

	private ToggleShrink(State: FShrinkerPlayerState): void
	{
		const bSettled: boolean = State.ShrinkAlpha === (State.bWantsShrunk ? 1 : 0);
		if (bSettled && (State.bWantsShrunk || State.Charge >= this.Settings.MinShrinkCharge))
		{
			State.bWantsShrunk = !State.bWantsShrunk;
		}
	}

	private TickCharge(State: FShrinkerPlayerState, DeltaTime: number): void
	{
		if (State.bWantsShrunk)
		{
			State.Charge = Math.max(0, State.Charge - (MaxShrinkCharge * DeltaTime) / this.Settings.ShrunkDuration);
			State.bWantsShrunk = State.Charge > 0;
		}
		else if (State.ShrinkAlpha === 0)
		{
			State.Charge = Math.min(MaxShrinkCharge, State.Charge + (MaxShrinkCharge * DeltaTime) / this.Settings.RechargeTime);
		}
	}

	private TickSize(Pawn: CSPlayerPawn, State: FShrinkerPlayerState, DeltaTime: number): void
	{
		const Target: number = State.bWantsShrunk ? 1 : 0;
		if (State.ShrinkAlpha === Target)
		{
			return;
		}
		const Duration: number = State.bWantsShrunk ? this.Settings.ShrinkTime : this.Settings.GrowTime;
		const Step: number = Duration > 0 ? DeltaTime / Duration : 1;
		State.ShrinkAlpha = State.bWantsShrunk ? Math.min(1, State.ShrinkAlpha + Step) : Math.max(0, State.ShrinkAlpha - Step);

		const Eased: number = State.ShrinkAlpha * State.ShrinkAlpha * (3 - 2 * State.ShrinkAlpha);
		Pawn.SetModelScale(this.Settings.SizeScale + (this.Settings.ShrunkScale - this.Settings.SizeScale) * Eased);
	}

	private GetPlayerState(Slot: number): FShrinkerPlayerState
	{
		return GetOrCreate(this.PlayerStates, Slot, (): FShrinkerPlayerState =>
		{
			return { Charge: MaxShrinkCharge, bWantsShrunk: false, ShrinkAlpha: 0, Held: { Mask: 0 } };
		});
	}
}