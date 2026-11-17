import type { CSPlayerPawn } from "cs_script/point_script";
import type { FVector } from "./bm_core";

// Where a mode wants a player to be: a cart to push or block, a point to hold. Within Radius of Position counts as being on it.
export interface FBotObjective
{
	readonly Position: FVector;
	readonly Radius: number;
}

export abstract class GameMode
{
	public abstract readonly DisplayName: string;
	public abstract readonly CommandName: string;
	// Whether picking a class changes it there and then, wherever the player is, rather than waiting for their spawn zone or next life
	public readonly bInstantClassSwitch: boolean = false;

	// Whether this map has what the mode needs. bm_main plays the first mode in GameModes that says yes.
	public abstract IsMapSetUp(): boolean;

	// Server settings for this mode, applied at each round start after the shared ones
	public GetMatchCommands(): string[]
	{
		return [];
	}

	// Called when this becomes the mode being played, and when another mode takes over
	public OnActivated(): void
	{
	}

	public OnDeactivated(): void
	{
	}

	public OnRoundStart(): void
	{
	}

	public OnRoundEnd(): void
	{
	}

	// Called whenever a player spawns or respawns
	public OnPlayerSpawn(Pawn: CSPlayerPawn, Slot: number): void
	{
	}

	// A player hurt by another player (never themselves)
	public OnPlayerDamage(VictimSlot: number, AttackerSlot: number, Damage: number): void
	{
	}

	// AttackerSlot is INDEX_NONE when nobody else got the kill
	public OnPlayerKill(VictimSlot: number, AttackerSlot: number): void
	{
	}

	// Called on every mode when a player leaves, so none of them keep stale state
	public OnPlayerLeave(Slot: number): void
	{
	}

	// What this mode would have a bot on this player's team look after right now, if anything
	public GetBotObjective(Pawn: CSPlayerPawn): FBotObjective | undefined
	{
		return undefined;
	}

	public Tick(Now: number, DeltaTime: number): void
	{
	}

	// Called every tick for each human player, for this mode's part of the HUD
	public TickPlayerHud(Pawn: CSPlayerPawn, Slot: number): void
	{
	}
}