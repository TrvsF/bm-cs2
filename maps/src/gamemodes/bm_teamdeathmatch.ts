import { Instance, Console, GameRules, CSRoundEndReason } from "cs_script/point_script";
import { ETeam, INDEX_NONE, LogPrefix } from "../bm_core";
import { GameMode, DamageLeaderboard } from "../bm_gamemode";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FTeamDeathmatchSettings
{
	readonly KillsToWin: number;
	readonly LeaderboardRows: number;
	// Bots fill each team up to this many players
	readonly TeamSize: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const TeamDeathmatchSettings: FTeamDeathmatchSettings =
{
	KillsToWin: 100,
	LeaderboardRows: 3,
	TeamSize: 8,
};

const GLeaderboard: DamageLeaderboard = new DamageLeaderboard(TeamDeathmatchSettings.LeaderboardRows);
const GTeamKills: Map<ETeam, number> = new Map<ETeam, number>();
let GWinner: ETeam | undefined = undefined;
let GbRoundEnded: boolean = false;

// Team deathmatch /////////////////////////////////////////////////////////////////////////////////

export class TeamDeathmatchMode extends GameMode
{
	public override readonly DisplayName: string = "Team deathmatch";
	public override readonly CommandName: string = "tdm";
	public override readonly bSwapTeamsEachRound: boolean = true;

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
			"mp_match_can_clinch 0",
			"mp_halftime 0",
			"mp_respawn_on_death_t 1",
			"mp_respawn_on_death_ct 1",
			"mp_use_respawn_waves 0",
			"mp_deathcam_skippable 1",
			"mp_roundtime 60",
			"mp_roundtime_defuse 60",
			"mp_roundtime_hostage 60",
			"bot_stop 0",
			"bot_quota_mode fill",
			`bot_quota ${TeamDeathmatchSettings.TeamSize * 2}`,
			"bot_join_team any",
			"mp_autoteambalance 1",
			"mp_limitteams 1",
		];
	}

	public override OnDeactivated(): void
	{
		GLeaderboard.Hide();
	}

	public override OnRoundStart(): void
	{
		GLeaderboard.Clear();
		GTeamKills.clear();
		// The scoreboard's team score counts this round's kills
		for (const Team of [ETeam.Terrorist, ETeam.CounterTerrorist])
		{
			GameRules.AddTeamScore(Team, -GameRules.GetTeamScore(Team));
		}
		GWinner = undefined;
		GbRoundEnded = false;
	}

	public override OnPlayerDamage(VictimSlot: number, AttackerSlot: number, Damage: number): void
	{
		if (IsCounting())
		{
			GLeaderboard.AddDamage(AttackerSlot, Damage);
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
		GLeaderboard.AddKill(AttackerSlot);
		const TeamKills: number = (GTeamKills.get(Team) ?? 0) + 1;
		GTeamKills.set(Team, TeamKills);
		GameRules.AddTeamScore(Team, 1);
		if (TeamKills >= TeamDeathmatchSettings.KillsToWin)
		{
			GWinner = Team;
		}
	}

	public override OnPlayerLeave(Slot: number): void
	{
		GLeaderboard.Forget(Slot);
	}

	public override Tick(Now: number, DeltaTime: number): void
	{
		if (GWinner !== undefined && !GbRoundEnded)
		{
			EndRound(GWinner);
		}
		GLeaderboard.Show();
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
	GameRules.TerminateRound(bTerrorists ? CSRoundEndReason.TERRORISTS_WIN : CSRoundEndReason.CTS_WIN);
}