import type { CSPlayerPawn, CSPlayerController } from "cs_script/point_script";
import { ETeam, ForEachPlayer } from "../bm_core";
import { GameMode } from "../bm_gamemode";
import { TickBots, ResetBotMode, ForgetBot, CountBotMarkers } from "../bm_bots";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FTrainingSettings
{
	// Bots to bring in when the map has no bot markers (bot_still, bot_run, bot_jump). With markers there is one bot each.
	readonly DefaultBotCount: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const TrainingSettings: FTrainingSettings =
{
	DefaultBotCount: 4,
};

// Training ////////////////////////////////////////////////////////////////////////////////////////

// Players are all Ts and can't hurt each other; the bots are the CTs, there to be shot at
export class TrainingMode extends GameMode
{
	public override readonly DisplayName: string = "Training";
	public override readonly CommandName: string = "training";
	public override readonly bInstantClassSwitch: boolean = true;

	public override IsMapSetUp(): boolean
	{
		return true;
	}

	public override GetMatchCommands(): string[]
	{
		const Markers: number = CountBotMarkers();
		return [
			"mp_teammates_are_enemies 0",
			"mp_friendlyfire 0",
			"mp_ignore_round_win_conditions 1",
			"mp_respawn_on_death_t 1",
			"mp_respawn_on_death_ct 1",
			"mp_roundtime 60",
			"mp_roundtime_defuse 60",
			"mp_roundtime_hostage 60",
			"mp_autoteambalance 0",
			"mp_limitteams 0",
			"mp_humanteam t",
			"bot_join_team ct",
			"bot_stop 1",
			"bot_quota_mode normal",
			`bot_quota ${Markers > 0 ? Markers : TrainingSettings.DefaultBotCount}`,
		];
	}

	public override OnPlayerSpawn(Pawn: CSPlayerPawn, Slot: number): void
	{
		ResetBotMode(Slot);
	}

	public override OnPlayerLeave(Slot: number): void
	{
		ForgetBot(Slot);
	}

	public override Tick(Now: number, DeltaTime: number): void
	{
		TickBots(Now);

		// Anyone who ended up on the wrong side is moved over
		ForEachPlayer((Controller: CSPlayerController): void =>
		{
			const bBot: boolean = Controller.IsBot();
			if (Controller.GetTeamNumber() === (bBot ? ETeam.Terrorist : ETeam.CounterTerrorist))
			{
				Controller.JoinTeam(bBot ? ETeam.CounterTerrorist : ETeam.Terrorist);
			}
		});
	}
}