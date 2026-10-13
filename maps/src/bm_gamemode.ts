import type { CSPlayerPawn } from "cs_script/point_script";

export abstract class GameMode
{
	public abstract readonly DisplayName: string;

	// Whether this map has what the mode needs. bm_main plays the first mode in GameModes that says yes.
	public abstract IsMapSetUp(): boolean;

	// Whether teammates can hurt each other
	public abstract IsFriendlyFire(): boolean;

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

	// Called on every mode when a player leaves, so none of them keep stale state
	public OnPlayerLeave(Slot: number): void
	{
	}

	public Tick(Now: number, DeltaTime: number): void
	{
	}

	// Called every tick for each human player, for this mode's part of the HUD
	public TickPlayerHud(Pawn: CSPlayerPawn, Slot: number): void
	{
	}
}
