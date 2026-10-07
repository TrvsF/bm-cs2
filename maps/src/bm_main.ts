import { Instance, CSDamageTypes } from "cs_script/point_script";
import type { CSPlayerPawn, CSPlayerController, CSWeaponBase } from "cs_script/point_script";
import { bDebug, TickInterval, LogPrefix, INDEX_NONE, GetPlayerSlot, IsWeapon, SetTimer, TickTimers, ForEachLivePawn } from "./bm_core";
import type
{
	FPlayerChatEvent,
	FPlayerResetEvent,
	FPlayerKillEvent,
	FPlayerDisconnectEvent,
	FGunFireEvent,
	FPlayerDamageEvent,
	FModifyDamageEvent,
	FModifyDamageResult,
} from "./bm_core";
import { EPlayerClass, ClassDefinitions, GiveLoadout, RestoreDefaultBody } from "./bm_classes";
import type { EPlayableClass } from "./bm_classes";
import { ClearDecals } from "./bm_effects";
import { ShowDamageNumber, ResetDamageNumbers } from "./bm_hud";
import { TickBots, ResetBotMode, ForgetBot } from "./bm_bots";

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const ClassChatCommands: ReadonlyMap<string, EPlayerClass> = new Map<string, EPlayerClass>(
	[
		["!demo", EPlayerClass.Demoman],
		["!medic", EPlayerClass.Medic],
		["!solider", EPlayerClass.Solider],
		["!none", EPlayerClass.None],
	]
);

// Main ///////////////////////////////////////////////////////////////////////////////////////////

function Tick(): void
{
	const Now: number = Instance.GetGameTime();
	Instance.SetNextThink(Now + TickInterval);
	const DeltaTime: number = Math.min(0.1, Math.max(0, Now - GLastThinkTime)) || TickInterval;
	GLastThinkTime = Now;

	try
	{
		TickMatch(Now);
		TickTimers(Now);

		for (const Definition of Object.values(ClassDefinitions))
		{
			Definition.TickWorld(Now, DeltaTime);
		}
		ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
		{
			const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
			if (PlayerClass !== undefined)
			{
				ClassDefinitions[PlayerClass].TickPlayer(Pawn, Slot, Now, DeltaTime);
			}
		});
		for (const Definition of Object.values(ClassDefinitions))
		{
			Definition.TickWorldLate(Now, DeltaTime);
		}

		TickBots(Now); // last, so a problem here can't stop the gameplay above
	}
	catch (Exception: unknown)
	{
		Instance.Msg(`${LogPrefix} error: ${String(Exception)}`);
	}
}

function BeginPlay(): void
{
	Instance.OnPlayerChat(HandlePlayerChat);
	Instance.OnPlayerReset(HandlePlayerReset);
	Instance.OnPlayerKill(HandlePlayerKill);
	Instance.OnPlayerDisconnect(HandlePlayerDisconnect);
	Instance.OnRoundStart(HandleRoundStart);
	Instance.OnGunFire(HandleGunFire);
	Instance.OnPlayerDamage(HandlePlayerDamage);
	Instance.OnModifyPlayerDamage(HandleModifyPlayerDamage);

	Instance.SetThink(Tick);
	Instance.SetNextThink(Instance.GetGameTime());
	Instance.Msg(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}`);
}

BeginPlay(); // !

// Handle /////////////////////////////////////////////////////////////////////////////////////////

function HandlePlayerChat(Event: FPlayerChatEvent): void
{
	const Player: CSPlayerController | undefined = Event.player;
	if (!Player)
	{
		return;
	}

	const Command: string = Event.text.trim().toLowerCase();
	if (bDebug && Command === "!hudtest")
	{
		ShowDamageNumber(Player.GetPlayerSlot(), 123);
		return;
	}

	const PlayerClass: EPlayerClass | undefined = ClassChatCommands.get(Command);
	if (PlayerClass === undefined)
	{
		return;
	}

	const Slot: number = Player.GetPlayerSlot();
	ClearPlayer(Slot);

	const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
	if (PlayerClass === EPlayerClass.None)
	{
		GClassBySlot.delete(Slot);
		if (Pawn && Pawn.IsAlive())
		{
			RestoreDefaultBody(Pawn);
		}
	}
	else
	{
		GClassBySlot.set(Slot, PlayerClass);
		if (Pawn && Pawn.IsAlive())
		{
			GiveLoadout(Pawn, PlayerClass);
		}
	}

	const ClassLabel: string = PlayerClass === EPlayerClass.None ? "normal" : PlayerClass;
	Instance.Msg(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}

function HandlePlayerReset(Event: FPlayerResetEvent): void
{
	const Pawn: CSPlayerPawn = Event.player;
	const Slot: number = GetPlayerSlot(Pawn);
	if (Slot === INDEX_NONE)
	{
		return;
	}

	ClearPlayer(Slot);
	ResetBotMode(Slot);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
	if (PlayerClass === undefined)
	{
		return;
	}

	SetTimer(0.1, (): void =>
	{
		if (Pawn.IsValid() && Pawn.IsAlive())
		{
			GiveLoadout(Pawn, PlayerClass);
		}
	});
}

function HandlePlayerKill(Event: FPlayerKillEvent): void
{
	const Slot: number = GetPlayerSlot(Event.player);
	if (Slot !== INDEX_NONE)
	{
		ClearPlayer(Slot);
	}
}

function HandlePlayerDisconnect(Event: FPlayerDisconnectEvent): void
{
	ClearPlayer(Event.playerSlot);
	ForgetBot(Event.playerSlot);
	ResetDamageNumbers(Event.playerSlot);
	GClassBySlot.delete(Event.playerSlot);
}

function HandleRoundStart(): void
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		Definition.OnRoundStart();
	}
	ClearDecals();
	ApplyMatchSettings();
	Instance.Msg(`${LogPrefix} match settings applied`);
}

function HandleGunFire(Event: FGunFireEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	const Pawn: CSPlayerPawn | undefined = Weapon.GetOwner();
	const Slot: number = GetPlayerSlot(Pawn);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
	if (!Pawn || PlayerClass === undefined)
	{
		return;
	}

	const Definition = ClassDefinitions[PlayerClass];
	if (IsWeapon(Weapon, Definition.Settings.Primary))
	{
		Definition.OnPrimaryFire(Pawn, Slot, Instance.GetGameTime());
	}
}

function HandlePlayerDamage(Event: FPlayerDamageEvent): void
{
	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	if (AttackerSlot === INDEX_NONE || Event.attacker === Event.player)
	{
		return;
	}
	ShowDamageNumber(AttackerSlot, Event.damage);
}

function HandleModifyPlayerDamage(Event: FModifyDamageEvent): FModifyDamageResult
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		const Result: FModifyDamageResult = Definition.ModifyAnyDamage(Event);
		if (Result)
		{
			return Result;
		}
	}

	// fall-damage
	if ((Event.damageTypes & CSDamageTypes.FALL) !== 0 && GClassBySlot.has(GetPlayerSlot(Event.player)))
	{
		// const FallSpeed: number = 580 + Event.damage * (1024 - 580) / 100; // undoes cs2's fall formula
		// if (FallSpeed <= 650)
		// {
		// 	return { abort: true };
		// }
		// return { damage: Math.round(5 * (FallSpeed / 300) * (Event.player.GetMaxHealth() / 100)) };

		return { abort: true };
	}

	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	const AttackerClass: EPlayableClass | undefined = GClassBySlot.get(AttackerSlot);
	if (AttackerClass === undefined)
	{
		return;
	}

	return ClassDefinitions[AttackerClass].ModifyOutgoingDamage(Event);
}

// Globals ////////////////////////////////////////////////////////////////////////////////////////

const GClassBySlot: Map<number, EPlayableClass> = new Map<number, EPlayableClass>();
let GLastThinkTime: number = 0;

// Match //////////////////////////////////////////////////////////////////////////////////////////

function ApplyMatchSettings(): void
{
	const Commands: string[] = [];

	if (bDebug)
	{
		Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
		Commands.push("mp_roundtime 60", "mp_roundtime_defuse 60", "mp_roundtime_hostage 60");
		Commands.push("mp_ignore_round_win_conditions 1", "mp_respawn_on_death_t 1", "mp_respawn_on_death_ct 1");
		Commands.push("sv_infinite_ammo 1");
		Commands.push("bot_quota_mode fill", "bot_quota 8", "bot_join_team any", "bot_stop 1");
	}

	for (const Command of Commands)
	{
		Instance.ServerCommand(Command);
	}
}

function TickMatch(Now: number): void
{
	if (bDebug && Instance.IsWarmupPeriod())
	{
		Instance.ServerCommand("mp_warmup_end");
	}
}

// Player //////////////////////////////////////////////////////////////////////////////////////////

function ClearPlayer(Slot: number): void
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		Definition.ClearPlayer(Slot);
	}
}
