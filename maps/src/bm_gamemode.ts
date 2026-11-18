import type { CSPlayerPawn, CSPlayerController } from "cs_script/point_script";
import { ETeam, GetOrCreate, ForEachPlayer } from "./bm_core";
import type { FVector } from "./bm_core";
import { ShowLeaderboard, ShowLeaderboardYou } from "./bm_ui";
import type { FLeaderboardRow } from "./bm_ui";

// Where a mode wants a player to be: a cart to push or block, a point to hold. Within Radius of Position counts as being on it.
export interface FBotObjective
{
	readonly Position: FVector;
	readonly Radius: number;
}

interface FLeaderboardScore
{
	Kills: number;
	Damage: number;
}

export abstract class GameMode
{
	public abstract readonly DisplayName: string;
	public abstract readonly CommandName: string;
	// Whether picking a class changes it there and then, wherever the player is, rather than waiting for their spawn zone or next life
	public readonly bInstantClassSwitch: boolean = false;
	// Whether everyone changes sides (T and CT) between rounds
	public readonly bSwapTeamsEachRound: boolean = false;

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

// Damage leaderboard //////////////////////////////////////////////////////////////////////////////

// The board team modes show: the top few players on either team by damage, and your own row underneath if you're not among them
export class DamageLeaderboard
{
	private readonly MaxRows: number;
	private readonly Scores: Map<number, FLeaderboardScore> = new Map<number, FLeaderboardScore>();

	public constructor(MaxRows: number)
	{
		this.MaxRows = MaxRows;
	}

	public Clear(): void
	{
		this.Scores.clear();
	}

	public AddDamage(Slot: number, Damage: number): void
	{
		this.GetScore(Slot).Damage += Damage;
	}

	public AddKill(Slot: number): void
	{
		this.GetScore(Slot).Kills++;
	}

	public Forget(Slot: number): void
	{
		this.Scores.delete(Slot);
	}

	public Show(): void
	{
		const Rows: FLeaderboardRow[] = this.BuildRows();
		ShowLeaderboard(Rows, this.MaxRows);
		ForEachPlayer((Controller: CSPlayerController, Slot: number): void =>
		{
			if (!Controller.IsBot())
			{
				ShowLeaderboardYou(Slot, Rows, this.MaxRows);
			}
		});
	}

	public Hide(): void
	{
		ShowLeaderboard(undefined);
	}

	private GetScore(Slot: number): FLeaderboardScore
	{
		return GetOrCreate(this.Scores, Slot, (): FLeaderboardScore =>
		{
			return { Kills: 0, Damage: 0 };
		});
	}

	private BuildRows(): FLeaderboardRow[]
	{
		const Rows: FLeaderboardRow[] = [];
		ForEachPlayer((Controller: CSPlayerController, Slot: number): void =>
		{
			const Team: number = Controller.GetTeamNumber();
			if (Team !== ETeam.Terrorist && Team !== ETeam.CounterTerrorist)
			{
				return;
			}
			const Score: FLeaderboardScore | undefined = this.Scores.get(Slot);
			Rows.push({ Slot: Slot, Name: Controller.GetPlayerName(), Kills: Score ? Score.Kills : 0, Damage: Score ? Math.round(Score.Damage) : 0 });
		});
		return Rows.sort((A: FLeaderboardRow, B: FLeaderboardRow): number =>
		{
			return B.Damage - A.Damage || B.Kills - A.Kills || A.Slot - B.Slot;
		});
	}
}