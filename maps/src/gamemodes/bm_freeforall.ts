import type { CSPlayerPawn } from "cs_script/point_script";
import { bDebug } from "../bm_core";
import { GameMode } from "../bm_gamemode";
import { TickBots, ResetBotMode, ForgetBot } from "../bm_bots";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export interface FFreeForAllSettings
{
	readonly bFriendlyFire: boolean;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const FreeForAllSettings: FFreeForAllSettings =
{
	bFriendlyFire: true,
};

// Free for all ////////////////////////////////////////////////////////////////////////////////////

export class FreeForAllMode extends GameMode
{
	public override readonly DisplayName: string = "Free for all";

	public override IsMapSetUp(): boolean
	{
		return true;
	}

	public override IsFriendlyFire(): boolean
	{
		return FreeForAllSettings.bFriendlyFire;
	}

	public override GetMatchCommands(): string[]
	{
		if (!bDebug)
		{
			return [];
		}
		return [
			"mp_roundtime 60",
			"mp_roundtime_defuse 60",
			"mp_roundtime_hostage 60",
			"mp_ignore_round_win_conditions 1",
			"mp_respawn_on_death_t 1",
			"mp_respawn_on_death_ct 1",
			"bot_stop 1",
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
	}
}
