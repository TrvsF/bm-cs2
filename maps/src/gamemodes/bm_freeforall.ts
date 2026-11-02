import type { CSPlayerPawn, CSPlayerController } from "cs_script/point_script";
import { bDebug, ETeam, INDEX_NONE, GetOrCreate, ForEachPlayer } from "../bm_core";
import { GameMode } from "../bm_gamemode";
import { TickBots, ResetBotMode, ForgetBot } from "../bm_bots";
import { ShowLeaderboard, ShowLeaderboardYou } from "../bm_ui";
import type { FLeaderboardRow } from "../bm_ui";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

interface FPlayerScore
{
	Kills: number;
	Damage: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const GScores: Map<number, FPlayerScore> = new Map<number, FPlayerScore>();

// Free for all ////////////////////////////////////////////////////////////////////////////////////

export class FreeForAllMode extends GameMode
{
	public override readonly DisplayName: string = "Free for all";

	public override IsMapSetUp(): boolean
	{
		return true;
	}

	public override GetMatchCommands(): string[]
	{
		const Commands: string[] = [
			"mp_teammates_are_enemies 1",
			"mp_friendlyfire 1",
			"mp_ignore_round_win_conditions 1",
			"mp_respawn_on_death_t 1",
			"mp_respawn_on_death_ct 1",
			"mp_roundtime 60",
			"mp_roundtime_defuse 60",
			"mp_roundtime_hostage 60",
		];
		if (bDebug)
		{
			Commands.push("bot_stop 1");
		}
		return Commands;
	}

	public override OnDeactivated(): void
	{
		ShowLeaderboard(undefined);
	}

	public override OnRoundStart(): void
	{
		GScores.clear();
	}

	public override OnPlayerSpawn(Pawn: CSPlayerPawn, Slot: number): void
	{
		ResetBotMode(Slot);
	}

	public override OnPlayerDamage(VictimSlot: number, AttackerSlot: number, Damage: number): void
	{
		GetScore(AttackerSlot).Damage += Damage;
	}

	public override OnPlayerKill(VictimSlot: number, AttackerSlot: number): void
	{
		if (AttackerSlot !== INDEX_NONE)
		{
			GetScore(AttackerSlot).Kills++;
		}
	}

	public override OnPlayerLeave(Slot: number): void
	{
		ForgetBot(Slot);
		GScores.delete(Slot);
	}

	public override Tick(Now: number, DeltaTime: number): void
	{
		TickBots(Now);

		const Rows: FLeaderboardRow[] = BuildLeaderboard();
		ShowLeaderboard(Rows);
		ForEachPlayer((Controller: CSPlayerController, Slot: number): void =>
		{
			if (!Controller.IsBot())
			{
				ShowLeaderboardYou(Slot, Rows);
			}
		});
	}
}

function GetScore(Slot: number): FPlayerScore
{
	return GetOrCreate(GScores, Slot, (): FPlayerScore =>
	{
		return { Kills: 0, Damage: 0 };
	});
}

function BuildLeaderboard(): FLeaderboardRow[]
{
	const Rows: FLeaderboardRow[] = [];
	ForEachPlayer((Controller: CSPlayerController, Slot: number): void =>
	{
		const Team: number = Controller.GetTeamNumber();
		if (Team !== ETeam.Terrorist && Team !== ETeam.CounterTerrorist)
		{
			return;
		}
		const Score: FPlayerScore | undefined = GScores.get(Slot);
		Rows.push({ Slot: Slot, Name: Controller.GetPlayerName(), Kills: Score ? Score.Kills : 0, Damage: Score ? Math.round(Score.Damage) : 0 });
	});
	return Rows.sort((A: FLeaderboardRow, B: FLeaderboardRow): number =>
	{
		return B.Kills - A.Kills || B.Damage - A.Damage || A.Slot - B.Slot;
	});
}
