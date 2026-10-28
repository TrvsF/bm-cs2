import { CSInputs } from "cs_script/point_script";
import type { CSPlayerPawn } from "cs_script/point_script";
import { GetOrCreate, IsKnife } from "../bm_core";
import { PlayerClass } from "../bm_classes";
import type { FClassSettings, FHudCounter } from "../bm_classes";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FShrinkerSettings extends FClassSettings
{
	readonly ShrinkKey: CSInputs;
	readonly ShrunkScale: number;
	readonly ShrinkTime: number;
	readonly GrowTime: number;
	readonly ShrunkDuration: number;
	readonly RechargeTime: number;
	readonly MinShrinkCharge: number;
}

interface FShrinkerPlayerState
{
	Charge: number;
	bWantsShrunk: boolean;
	ShrinkAlpha: number;
	bShrinkKeyHeld: boolean;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const ShrinkerSettings: FShrinkerSettings =
{
	DisplayName: "Shrinker",
	PickFxTemplate: "shrinker_pick_template",
	Primary: "weapon_glock",
	Secondary: "",
	Melee: "weapon_knife",
	Health: 125,
	SizeScale: 1.0,
	bStartWithMelee: true,
	PrimaryLauncher: undefined,
	SecondaryLauncher: undefined,

	ShrinkKey: CSInputs.ATTACK2,
	ShrunkScale: 0.4,
	ShrinkTime: 0.75,
	GrowTime: 0.75,
	ShrunkDuration: 8,
	RechargeTime: 16,
	MinShrinkCharge: 10,
};

const MaxShrinkCharge: number = 100;

// Shrinker ////////////////////////////////////////////////////////////////////////////////////////

export class ShrinkerClass extends PlayerClass<FShrinkerSettings>
{
	private PlayerStates: Map<number, FShrinkerPlayerState> = new Map<number, FShrinkerPlayerState>();

	constructor()
	{
		super(ShrinkerSettings);
	}

	public override TickPlayer(Pawn: CSPlayerPawn, Slot: number, Now: number, DeltaTime: number): void
	{
		const State: FShrinkerPlayerState = this.GetPlayerState(Slot);
		const bKeyDown: boolean = Pawn.IsInputPressed(this.Settings.ShrinkKey);
		if (bKeyDown && !State.bShrinkKeyHeld && IsKnife(Pawn.GetActiveWeapon()))
		{
			this.ToggleShrink(State);
		}
		State.bShrinkKeyHeld = bKeyDown;

		this.TickCharge(State, DeltaTime);
		this.TickSize(Pawn, State, DeltaTime);
	}

	public override ClearPlayer(Slot: number): void
	{
		this.PlayerStates.delete(Slot);
	}

	public override GetHudCounter(Slot: number): FHudCounter | undefined
	{
		const State: FShrinkerPlayerState | undefined = this.PlayerStates.get(Slot);
		return { Label: "Shrink", Count: Math.floor(State ? State.Charge : MaxShrinkCharge), Max: MaxShrinkCharge };
	}

	// Ignored until the last shrink or grow has finished
	private ToggleShrink(State: FShrinkerPlayerState): void
	{
		const bSettled: boolean = State.ShrinkAlpha === (State.bWantsShrunk ? 1 : 0);
		if (bSettled && (State.bWantsShrunk || State.Charge >= this.Settings.MinShrinkCharge))
		{
			State.bWantsShrunk = !State.bWantsShrunk;
		}
	}

	// Drains while shrunk, growing them back when it runs out, and only refills at full size
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
			return { Charge: MaxShrinkCharge, bWantsShrunk: false, ShrinkAlpha: 0, bShrinkKeyHeld: false };
		});
	}
}