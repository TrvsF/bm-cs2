import { Instance, Console, GameRules, CSDamageTypes, CSDamageFlags, CSGearSlot } from "cs_script/point_script";
import type { CSPlayerPawn, CSPlayerController, CSWeaponBase } from "cs_script/point_script";
import { bDebug, IsFriendlyFire, SetFriendlyFire, TickInterval, LogPrefix, ChatCommandPrefix, INDEX_NONE, GetPlayerSlot, IsWeapon, SetTimer, TickTimers, ForEachLivePawn } from "./bm_core";
import type
{
	FPlayerChatEvent,
	FPlayerResetEvent,
	FPlayerKillEvent,
	FPlayerDisconnectEvent,
	FGunFireEvent,
	FWeaponPickupEvent,
	FWeaponDropEvent,
	FPlayerDamageEvent,
	FCustomHudClickedEvent,
	FModifyDamageEvent,
	FModifyDamageResult,
} from "./bm_core";
import { EPlayerClass, ClassDefinitions, GiveLoadout, GiveNoClassLoadout, IsWeaponAllowed, RestoreDefaultBody, PickRandomClass } from "./bm_classes";
import type { EPlayableClass } from "./bm_classes";
import { ClearDecals } from "./bm_effects";
import { ShowDamageNumber, ShowAirshot, ResetDamageNumbers } from "./bm_hud";
import { GetHeightAboveGround } from "./bm_combat";
import { OpenClassMenu, CloseClassMenu, OfferClassMenu, TickClassMenuKey, ReadClassMenuClick, ShowClassIndicator, ShowAmmo, ShowHealth, ShowCounter, ResetClassUi } from "./bm_ui";
import { TickLauncher, ClearLauncher, GetLauncherAmmo } from "./bm_launcher";
import { TickHealthKits, ResetHealthKits } from "./bm_pickups";
import { TickSpawnZones, ResetSpawnZones, ForgetSpawnZonePlayer } from "./bm_spawnzones";
import { GameMode } from "./bm_gamemode";
import { FreeForAllMode } from "./bm_freeforall";
import { PayloadMode } from "./bm_payload";
import type { FClassMenuChoice } from "./bm_ui";

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const AirshotMinHeight: number = 64;

const FreeForAll: FreeForAllMode = new FreeForAllMode();
const GameModes: readonly GameMode[] = [new PayloadMode(), FreeForAll];
let GActiveMode: GameMode = FreeForAll;

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
				const Definition = ClassDefinitions[PlayerClass];
				const FiredWeapon: string | undefined = TickLauncher(Pawn, Slot, Now);
				if (FiredWeapon === Definition.Settings.Primary)
				{
					Definition.OnPrimaryFire(Pawn, Slot, Now);
				}
				else if (FiredWeapon === Definition.Settings.Secondary)
				{
					Definition.OnSecondaryFire(Pawn, Slot, Now);
				}
				Definition.TickPlayer(Pawn, Slot, Now, DeltaTime);
			}
		});
		for (const Definition of Object.values(ClassDefinitions))
		{
			Definition.TickWorldLate(Now, DeltaTime);
		}
		GActiveMode.Tick(Now, DeltaTime);
		TickHealthKits(Now);
		TickSpawnZones(Now);

		TickClassMenuKey();
		TickPlayerHud();
		TickNoBuying();
		TickBotClasses();
	}
	catch (Exception: unknown)
	{
		Console.Log(`${LogPrefix} error: ${String(Exception)}`);
	}
}

function BeginPlay(): void
{
	SelectGameMode();
	Instance.OnPlayerChat(HandlePlayerChat);
	Instance.OnPlayerReset(HandlePlayerReset);
	Instance.OnPlayerKill(HandlePlayerKill);
	Instance.OnPlayerDisconnect(HandlePlayerDisconnect);
	Instance.OnRoundStart(HandleRoundStart);
	Instance.OnRoundEnd(HandleRoundEnd);
	Instance.OnGunFire(HandleGunFire);
	Instance.OnWeaponPickup(HandleWeaponPickup);
	Instance.OnWeaponDrop(HandleWeaponDrop);
	Instance.OnPlayerDamage(HandlePlayerDamage);
	Instance.OnModifyPlayerDamage(HandleModifyPlayerDamage);
	Instance.OnCustomHudClicked(HandleCustomHudClicked);

	Instance.SetThink(Tick);
	Instance.SetNextThink(Instance.GetGameTime());
	Console.Log(`${LogPrefix} loaded${bDebug ? " (DEBUG on)" : ""}`);
}

BeginPlay(); // !

// Handle /////////////////////////////////////////////////////////////////////////////////////////

function HandlePlayerChat(Event: FPlayerChatEvent): void
{
	const Player: CSPlayerController | undefined = Event.player;
	const Text: string = Event.text.trim().toLowerCase();
	if (!Player || !Text.startsWith(ChatCommandPrefix))
	{
		return;
	}

	const Command: string = Text.substring(ChatCommandPrefix.length);
	const PlayerClass: EPlayerClass | undefined = Object.values(EPlayerClass).find((Candidate: EPlayerClass): boolean =>
	{
		return Candidate === Command;
	});

	if (Command === "class")
	{
		OpenClassMenu(Player.GetPlayerSlot());
	}
	else if (Command === "start")
	{
		EndWarmupNow(Player);
	}
	else if (Command === "hudtest" && bDebug)
	{
		ShowDamageNumber(Player.GetPlayerSlot(), 123);
	}
	else if (PlayerClass !== undefined)
	{
		RequestPlayerClass(Player, PlayerClass);
	}
	else
	{
		Console.Log(`${LogPrefix} ${Player.GetPlayerName()} typed an unknown command: ${ChatCommandPrefix}${Command}`);
	}
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
	ForgetSpawnZonePlayer(Slot);
	GActiveMode.OnPlayerSpawn(Pawn, Slot);
	AssignRandomBotClass(Pawn, Slot);
	const bHadClass: boolean = GClassBySlot.has(Slot);
	ApplyPendingClass(Slot);
	RefreshClassUi(Pawn, Slot);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);

	SetTimer(0.1, (): void =>
	{
		if (!Pawn.IsValid() || !Pawn.IsAlive())
		{
			return;
		}
		if (PlayerClass === undefined)
		{
			if (bHadClass)
			{
				RestoreDefaultBody(Pawn);
			}
			GiveNoClassLoadout(Pawn);
		}
		else
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
		ForgetSpawnZonePlayer(Slot);
	}
}

function HandlePlayerDisconnect(Event: FPlayerDisconnectEvent): void
{
	ClearPlayer(Event.playerSlot);
	ForgetSpawnZonePlayer(Event.playerSlot);
	for (const Mode of GameModes)
	{
		Mode.OnPlayerLeave(Event.playerSlot);
	}
	ResetDamageNumbers(Event.playerSlot);
	ResetClassUi(Event.playerSlot);
	GClassBySlot.delete(Event.playerSlot);
	GPendingClassBySlot.delete(Event.playerSlot);
}

function HandleRoundStart(): void
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		Definition.OnRoundStart();
	}
	ClearDecals();
	ResetHealthKits();
	ResetSpawnZones();
	SelectGameMode();
	GActiveMode.OnRoundStart();
	ApplyMatchSettings();
	Console.Log(`${LogPrefix} match settings applied (${GActiveMode.DisplayName})`);
}

function HandleRoundEnd(): void
{
	GActiveMode.OnRoundEnd();
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
	if (IsWeapon(Weapon, Definition.Settings.Primary) && !Definition.Settings.PrimaryLauncher)
	{
		Definition.OnPrimaryFire(Pawn, Slot, Instance.GetGameTime());
	}
	else if (IsWeapon(Weapon, Definition.Settings.Secondary) && !Definition.Settings.SecondaryLauncher)
	{
		Definition.OnSecondaryFire(Pawn, Slot, Instance.GetGameTime());
	}
}

function HandleWeaponPickup(Event: FWeaponPickupEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	SetTimer(0, (): void =>
	{
		RemoveIfNotAllowed(Weapon);
	});
}

function HandleWeaponDrop(Event: FWeaponDropEvent): void
{
	const Weapon: CSWeaponBase = Event.weapon;
	const Dropper: CSPlayerPawn = Event.dropper;
	SetTimer(0, (): void =>
	{
		RemoveDeathDrop(Weapon, Dropper);
	});
}

function HandlePlayerDamage(Event: FPlayerDamageEvent): void
{
	const AttackerSlot: number = GetPlayerSlot(Event.attacker);
	if (AttackerSlot === INDEX_NONE || Event.attacker === Event.player)
	{
		return;
	}
	ShowDamageNumber(AttackerSlot, Event.damage);

	if (GetHeightAboveGround(Event.player, AirshotMinHeight) >= AirshotMinHeight)
	{
		ShowAirshot(AttackerSlot);
	}
}

function HandleCustomHudClicked(Event: FCustomHudClickedEvent): void
{
	const Choice: FClassMenuChoice = ReadClassMenuClick(Event.layout, Event.buttonId);
	if (Choice === undefined)
	{
		return;
	}

	CloseClassMenu(Event.player.GetPlayerSlot());
	if (Choice !== "close")
	{
		RequestPlayerClass(Event.player, Choice);
	}
}

function HandleModifyPlayerDamage(Event: FModifyDamageEvent): FModifyDamageResult
{
	// Forced deaths skip every damage rule, uber included
	if ((Event.damageFlags & CSDamageFlags.FORCE_DEATH) !== 0)
	{
		return;
	}

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
const GPendingClassBySlot: Map<number, EPlayerClass> = new Map<number, EPlayerClass>();
let GLastThinkTime: number = 0;

// Match //////////////////////////////////////////////////////////////////////////////////////////

// Plays the first mode in GameModes the map is set up for, and takes its friendly fire rule
function SelectGameMode(): void
{
	const Mode: GameMode = GameModes.find((Candidate: GameMode): boolean =>
	{
		return Candidate.IsMapSetUp();
	}) ?? FreeForAll;

	if (Mode !== GActiveMode)
	{
		GActiveMode.OnDeactivated();
		GActiveMode = Mode;
		Mode.OnActivated();
		Console.Log(`${LogPrefix} game mode: ${Mode.DisplayName}`);
	}
	SetFriendlyFire(Mode.IsFriendlyFire());
}

function ApplyMatchSettings(): void
{
	const Commands: string[] = [];

	Commands.push(`mp_teammates_are_enemies ${IsFriendlyFire() ? 1 : 0}`, `mp_friendlyfire ${IsFriendlyFire() ? 1 : 0}`);

	if (bDebug)
	{
		Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
		Commands.push("sv_infinite_ammo 1");
		Commands.push("bot_quota_mode fill", "bot_quota 8", "bot_join_team any");
	}
	Commands.push(...GActiveMode.GetMatchCommands());

	for (const Command of Commands)
	{
		Console.ServerCommand(Command);
	}
}

function EndWarmupNow(Player: CSPlayerController): void
{
	if (!GameRules.IsWarmupPeriod())
	{
		Console.Log(`${LogPrefix} ${Player.GetPlayerName()} typed ${ChatCommandPrefix}start, but warmup is already over`);
		return;
	}
	Console.Log(`${LogPrefix} ${Player.GetPlayerName()} ended warmup`);
	GameRules.EndWarmup();
}

function TickMatch(Now: number): void
{
	if (bDebug && GameRules.IsWarmupPeriod())
	{
		Console.ServerCommand("mp_warmup_end");
	}
}

// Player //////////////////////////////////////////////////////////////////////////////////////////

function RequestPlayerClass(Player: CSPlayerController, PlayerClass: EPlayerClass): void
{
	const Slot: number = Player.GetPlayerSlot();
	const CurrentClass: EPlayerClass = GClassBySlot.get(Slot) ?? EPlayerClass.None;
	const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
	const bAlive: boolean = Pawn !== undefined && Pawn.IsValid() && Pawn.IsAlive();

	if (!bAlive || CurrentClass === EPlayerClass.None)
	{
		GPendingClassBySlot.delete(Slot);
		SetPlayerClass(Player, PlayerClass);
		return;
	}

	if (PlayerClass === CurrentClass)
	{
		GPendingClassBySlot.delete(Slot);
	}
	else
	{
		GPendingClassBySlot.set(Slot, PlayerClass);
	}
	ShowClassIndicator(Slot, CurrentClass, Pawn?.GetTeamNumber() === 2);
	Console.Log(`${LogPrefix} ${Player.GetPlayerName()} -> ${PlayerClass} on respawn`);
}

function ApplyPendingClass(Slot: number): void
{
	const NextClass: EPlayerClass | undefined = GPendingClassBySlot.get(Slot);
	if (NextClass === undefined)
	{
		return;
	}

	GPendingClassBySlot.delete(Slot);
	if (NextClass === EPlayerClass.None)
	{
		GClassBySlot.delete(Slot);
	}
	else
	{
		GClassBySlot.set(Slot, NextClass);
	}
}

function SetPlayerClass(Player: CSPlayerController, PlayerClass: EPlayerClass): void
{
	const Slot: number = Player.GetPlayerSlot();
	ClearPlayer(Slot);

	const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
	if (PlayerClass === EPlayerClass.None)
	{
		GClassBySlot.delete(Slot);
		if (Pawn && Pawn.IsAlive())
		{
			RestoreDefaultBody(Pawn);
			GiveNoClassLoadout(Pawn);
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
	ShowClassIndicator(Slot, PlayerClass, Pawn?.GetTeamNumber() === 2);

	const ClassLabel: string = PlayerClass === EPlayerClass.None ? "normal" : PlayerClass;
	Console.Log(`${LogPrefix} ${Player.GetPlayerName()} -> ${ClassLabel}`);
}

function AssignRandomBotClass(Pawn: CSPlayerPawn, Slot: number): boolean
{
	const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
	if (!Controller || !Controller.IsBot() || GClassBySlot.has(Slot) || GPendingClassBySlot.has(Slot))
	{
		return false;
	}
	const PlayerClass: EPlayableClass = PickRandomClass();
	GClassBySlot.set(Slot, PlayerClass);
	Console.Log(`${LogPrefix} ${Controller.GetPlayerName()} (bot) -> ${PlayerClass}`);
	return true;
}

function TickBotClasses(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const PlayerClass: EPlayableClass | undefined = AssignRandomBotClass(Pawn, Slot) ? GClassBySlot.get(Slot) : undefined;
		if (PlayerClass !== undefined)
		{
			GiveLoadout(Pawn, PlayerClass);
		}
	});
}

function RefreshClassUi(Pawn: CSPlayerPawn, Slot: number): void
{
	const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
	if (!Controller || Controller.IsBot())
	{
		return;
	}

	const PlayerClass: EPlayerClass = GClassBySlot.get(Slot) ?? EPlayerClass.None;
	ShowClassIndicator(Slot, PlayerClass, Pawn?.GetTeamNumber() === 2);
	SetTimer(0.5, (): void =>
	{
		if (Pawn.IsValid() && Pawn.IsAlive())
		{
			OfferClassMenu(Slot, GClassBySlot.get(Slot) ?? EPlayerClass.None);
		}
	});
}

function ClearPlayer(Slot: number): void
{
	for (const Definition of Object.values(ClassDefinitions))
	{
		Definition.ClearPlayer(Slot);
	}
	ClearLauncher(Slot);
	ShowAmmo(Slot, undefined);
	ShowHealth(Slot, undefined);
	ShowCounter(Slot, undefined);
}

function TickPlayerHud(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (Controller && !Controller.IsBot())
		{
			const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
			ShowHealth(Slot, Pawn);
			ShowAmmo(Slot, GetLauncherAmmo(Pawn, Slot));
			ShowCounter(Slot, PlayerClass !== undefined ? ClassDefinitions[PlayerClass].GetHudCounter(Slot) : undefined);
			GActiveMode.TickPlayerHud(Pawn, Slot);
		}
	});
}

// Weapons /////////////////////////////////////////////////////////////////////////////////////////

function RemoveIfNotAllowed(Weapon: CSWeaponBase): void
{
	if (!Weapon.IsValid())
	{
		return;
	}
	const Pawn: CSPlayerPawn | undefined = Weapon.GetOwner();
	const Slot: number = GetPlayerSlot(Pawn);
	if (!Pawn || Slot === INDEX_NONE || !Pawn.IsAlive())
	{
		return;
	}

	const PlayerClass: EPlayerClass = GClassBySlot.get(Slot) ?? EPlayerClass.None;
	if (IsWeaponAllowed(PlayerClass, Weapon))
	{
		return;
	}
	Pawn.DestroyWeapon(Weapon);

	SetTimer(0, (): void =>
	{
		EnsureWeaponInHand(Pawn);
	});
}

function RemoveDeathDrop(Weapon: CSWeaponBase, Dropper: CSPlayerPawn): void
{
	if (!Weapon.IsValid() || Weapon.GetOwner())
	{
		return;
	}
	if (Dropper.IsValid() && Dropper.IsAlive())
	{
		return;
	}
	Weapon.Remove();
}

function EnsureWeaponInHand(Pawn: CSPlayerPawn): void
{
	if (!Pawn.IsValid() || !Pawn.IsAlive())
	{
		return;
	}
	const Active: CSWeaponBase | undefined = Pawn.GetActiveWeapon();
	if (Active && Active.IsValid())
	{
		return;
	}
	for (const GearSlot of [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE])
	{
		const Weapon: CSWeaponBase | undefined = Pawn.FindWeaponBySlot(GearSlot);
		if (Weapon)
		{
			Pawn.SwitchToWeapon(Weapon);
			return;
		}
	}
}

function TickNoBuying(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (!Controller)
		{
			return;
		}
		const Money: number = Controller.GetMoneySpendableNow();
		if (Money > 0)
		{
			Controller.AddMoneySpendableNow(-Money);
		}
	});
}