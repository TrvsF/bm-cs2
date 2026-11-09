import { Instance, Console, GameRules, CSRoundEndReason } from "cs_script/point_script";
import type { CSPlayerController } from "cs_script/point_script";
import { ETeam, INDEX_NONE, LogPrefix, GetOrCreate, ForEachPlayer } from "../bm_core";
import { GameMode } from "../bm_gamemode";
import { ShowTeamLeaderboard, ShowTeamLeaderboardYou } from "../bm_ui";
import type { FLeaderboardRow, FTeamLeaderboard } from "../bm_ui";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FTeamDeathmatchSettings
{
	readonly KillsToWin: number;
}

interface FPlayerScore
{
	Kills: number;
	Damage: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const TeamDeathmatchSettings: FTeamDeathmatchSettings =
{
	KillsToWin: 100,
};

const GScores: Map<number, FPlayerScore> = new Map<number, FPlayerScore>();
const GTeamKills: Map<ETeam, number> = new Map<ETeam, number>();
let GWinner: ETeam | undefined = undefined;
let GbRoundEnded: boolean = false;

// Team deathmatch /////////////////////////////////////////////////////////////////////////////////

export class TeamDeathmatchMode extends GameMode
{
	public override readonly DisplayName: string = "Team deathmatch";
	public override readonly CommandName: string = "tdm";

	public override IsMapSetUp(): boolean
	{
		return true;
	}

	public override GetMatchCommands(): string[]
	{
		return [
			"mp_teammates_are_enemies 0",
			"mp_friendlyfire 0",
			"mp_ignore_round_win_conditions 1",
			"mp_respawn_on_death_t 1",
			"mp_respawn_on_death_ct 1",
			"mp_use_respawn_waves 0",
			"mp_deathcam_skippable 1",
			"mp_roundtime 60",
			"mp_roundtime_defuse 60",
			"mp_roundtime_hostage 60",
			"bot_stop 0",
		];
	}

	public override OnDeactivated(): void
	{
		ShowTeamLeaderboard(undefined);
	}

	public override OnRoundStart(): void
	{
		GScores.clear();
		GTeamKills.clear();
		GWinner = undefined;
		GbRoundEnded = false;
	}

	public override OnPlayerDamage(VictimSlot: number, AttackerSlot: number, Damage: number): void
	{
		if (IsCounting())
		{
			GetScore(AttackerSlot).Damage += Damage;
		}
	}

	public override OnPlayerKill(VictimSlot: number, AttackerSlot: number): void
	{
		if (AttackerSlot === INDEX_NONE || !IsCounting())
		{
			return;
		}
		const Team: number | undefined = Instance.GetPlayerController(AttackerSlot)?.GetTeamNumber();
		if (Team !== ETeam.Terrorist && Team !== ETeam.CounterTerrorist)
		{
			return;
		}
		GetScore(AttackerSlot).Kills++;
		const TeamKills: number = (GTeamKills.get(Team) ?? 0) + 1;
		GTeamKills.set(Team, TeamKills);
		if (TeamKills >= TeamDeathmatchSettings.KillsToWin)
		{
			GWinner = Team;
		}
	}

	public override OnPlayerLeave(Slot: number): void
	{
		GScores.delete(Slot);
	}

	public override Tick(Now: number, DeltaTime: number): void
	{
		if (GWinner !== undefined && !GbRoundEnded)
		{
			EndRound(GWinner);
		}

		const Board: FTeamLeaderboard = BuildLeaderboard();
		ShowTeamLeaderboard(Board);
		ForEachPlayer((Controller: CSPlayerController, Slot: number): void =>
		{
			if (!Controller.IsBot())
			{
				ShowTeamLeaderboardYou(Slot, Board);
			}
		});
	}
}

function IsCounting(): boolean
{
	return GWinner === undefined && !GameRules.IsWarmupPeriod();
}

function EndRound(Winner: ETeam): void
{
	GbRoundEnded = true;
	const bTerrorists: boolean = Winner === ETeam.Terrorist;
	Console.Log(`${LogPrefix} ${bTerrorists ? "terrorists" : "counter-terrorists"} reached ${TeamDeathmatchSettings.KillsToWin} kills and win`);
	GameRules.AddTeamScore(Winner, 1);
	GameRules.TerminateRound(bTerrorists ? CSRoundEndReason.TERRORISTS_WIN : CSRoundEndReason.CTS_WIN);
}

function GetScore(Slot: number): FPlayerScore
{
	return GetOrCreate(GScores, Slot, (): FPlayerScore =>
	{
		return { Kills: 0, Damage: 0 };
	});
}

function BuildLeaderboard(): FTeamLeaderboard
{
	const Terrorists: FLeaderboardRow[] = [];
	const CounterTerrorists: FLeaderboardRow[] = [];
	ForEachPlayer((Controller: CSPlayerController, Slot: number): void =>
	{
		const Team: number = Controller.GetTeamNumber();
		const Rows: FLeaderboardRow[] | undefined = Team === ETeam.Terrorist ? Terrorists : Team === ETeam.CounterTerrorist ? CounterTerrorists : undefined;
		const Score: FPlayerScore | undefined = GScores.get(Slot);
		Rows?.push({ Slot: Slot, Name: Controller.GetPlayerName(), Kills: Score ? Score.Kills : 0, Damage: Score ? Math.round(Score.Damage) : 0 });
	});
	return {
		KillsToWin: TeamDeathmatchSettings.KillsToWin,
		TerroristKills: GTeamKills.get(ETeam.Terrorist) ?? 0,
		CounterTerroristKills: GTeamKills.get(ETeam.CounterTerrorist) ?? 0,
		Terrorists: Terrorists.sort(CompareRows),
		CounterTerrorists: CounterTerrorists.sort(CompareRows),
	};
}

function CompareRows(A: FLeaderboardRow, B: FLeaderboardRow): number
{
	return B.Kills - A.Kills || B.Damage - A.Damage || A.Slot - B.Slot;
}
