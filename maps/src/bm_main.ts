import { Instance, Console, GameRules, Entities, CSDamageTypes, CSDamageFlags, CSGearSlot } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CSWeaponBase, CSWeaponData, TraceResult } from "cs_script/point_script";
import { bDebug, TickInterval, LogPrefix, ChatCommandPrefix, INDEX_NONE, ETeam, VectorMath, GetPlayerSlot, GetPawnName, IsPlayerPawn, IsTeammate, IsWeapon, SetTimer, TickTimers, ForEachLivePawn } from "./bm_core";
import type
{
	FPlayerChatEvent,
	FPlayerResetEvent,
	FPlayerKillEvent,
	FPlayerDisconnectEvent,
	FGunFireEvent,
	FKnifeAttackEvent,
	FWeaponPickupEvent,
	FWeaponDropEvent,
	FPlayerDamageEvent,
	FCustomHudClickedEvent,
	FModifyDamageEvent,
	FModifyDamageResult,
	FVector,
} from "./bm_core";
import { EPlayerClass, GiveNoClassLoadout, RestoreDefaultBody, HideBody, ShowBody, ForgetPlayerModel, PickRandomClass } from "./bm_classes";
import type { EPlayableClass } from "./bm_classes";
import { ClassDefinitions, GiveLoadout, IsWeaponAllowed } from "./classes/bm_classlist";
import { MedicSettings } from "./classes/bm_medic";
import { TurretKind } from "./classes/bm_gunner";
import { ClearDecals, SpawnGibs, PrecacheSounds, RunSpawnTest } from "./bm_effects";
import { ShowDamageNumber, ShowAirshot, ResetDamageNumbers } from "./bm_hud";
import { GetHeightAboveGround } from "./bm_combat";
import { OpenClassMenu, CloseClassMenu, OfferClassMenu, TickClassMenuKey, ReadClassMenuClick, ShowClassIndicator, ShowAmmo, ShowHealth, ShowCounter, ShowBuildings, ShowBuildHints, ShowTargetId, ResetClassUi } from "./bm_ui";
import { TickLauncher, ClearLauncher, GetLauncherAmmo, EmptyRealGuns } from "./bm_launcher";
import type { FLauncherShot } from "./bm_launcher";
import { TickHealthKits, ResetHealthKits } from "./bm_pickups";
import { TickSpawnZones, ResetSpawnZones, ForgetSpawnZonePlayer, ForgetSpawnZoneHistory, IsInFriendlySpawnZone, RefreshSpawnZoneTouches } from "./bm_spawnzones";
import { TickBuildings, ClearBuildings, RemoveBuildings, GetBuildingHudRows, GetBuildHints, RepairBuildingInReach, TraceBuildings, GetTraceBuilding, IsBuildingEnemy } from "./bm_buildings";
import type { FBuilding, FBuildingHit, FBuildKeys } from "./bm_buildings";
import { GameMode } from "./bm_gamemode";
import { FreeForAllMode } from "./gamemodes/bm_freeforall";
import { PayloadMode } from "./gamemodes/bm_payload";
import { TeamDeathmatchMode } from "./gamemodes/bm_teamdeathmatch";
import type { FClassMenuChoice, FTargetId } from "./bm_ui";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

interface FMainSettings
{
	readonly MaxDeltaTime: number;
	readonly AirshotMinHeight: number;
	readonly TargetIdRange: number;
	readonly LoadoutDelay: number;
	readonly ClassMenuDelay: number;
	readonly MapModePrefix: string;
	readonly DebugBotQuota: number;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const MainSettings: FMainSettings =
{
	MaxDeltaTime: 0.1,
	AirshotMinHeight: 96,
	TargetIdRange: 3000,
	LoadoutDelay: 0.1,
	ClassMenuDelay: 0.5,
	MapModePrefix: "bm_gm_",
	DebugBotQuota: 8,
};

// Globals /////////////////////////////////////////////////////////////////////////////////////////

const DefaultMode: GameMode = new FreeForAllMode();
const GameModes: readonly GameMode[] = [new PayloadMode(), DefaultMode, new TeamDeathmatchMode()];
let GActiveMode: GameMode = DefaultMode;
let GChosenMode: GameMode | undefined = undefined;
const GClassBySlot: Map<number, EPlayableClass> = new Map<number, EPlayableClass>();
const GPendingClassBySlot: Map<number, EPlayerClass> = new Map<number, EPlayerClass>();
let GLastThinkTime: number = 0;

// Main ///////////////////////////////////////////////////////////////////////////////////////////

function Tick(): void
{
	const Now: number = Instance.GetGameTime();
	Instance.SetNextThink(Now + TickInterval);
	const DeltaTime: number = Math.min(MainSettings.MaxDeltaTime, Math.max(0, Now - GLastThinkTime)) || TickInterval;
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
				EmptyRealGuns(Pawn);
				const Shot: FLauncherShot | undefined = TickLauncher(Pawn, Slot, Now);
				if (Shot)
				{
					Definition.OnLauncherFired(Pawn, Slot, Now, Shot);
				}
				Definition.TickPlayer(Pawn, Slot, Now, DeltaTime);
			}
		});
		for (const Definition of Object.values(ClassDefinitions))
		{
			Definition.TickWorldLate(Now, DeltaTime);
		}
		TickBuildings(Now, DeltaTime);
		GActiveMode.Tick(Now, DeltaTime);
		TickHealthKits(Now);
		TickSpawnZones(Now);
		TickSpawnClassSwaps();

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
	PrecacheSounds();
	SelectGameMode();
	ApplyMatchSettings();
	Instance.OnPlayerChat(HandlePlayerChat);
	Instance.OnPlayerReset(HandlePlayerReset);
	Instance.OnPlayerKill(HandlePlayerKill);
	Instance.OnPlayerDisconnect(HandlePlayerDisconnect);
	Instance.OnRoundStart(HandleRoundStart);
	Instance.OnRoundEnd(HandleRoundEnd);
	Instance.OnGunFire(HandleGunFire);
	Instance.OnKnifeAttack(HandleKnifeAttack);
	Instance.OnWeaponPickup(HandleWeaponPickup);
	Instance.OnWeaponDrop(HandleWeaponDrop);
	Instance.OnPlayerDamage(HandlePlayerDamage);
	Instance.OnModifyPlayerDamage(HandleModifyPlayerDamage);
	Instance.OnCustomHudClicked(HandleCustomHudClicked);

	Instance.SetThink(Tick);
	Instance.SetNextThink(Instance.GetGameTime());
	Console.Log(`${LogPrefix} loaded${bDebug ? " DEBUG mode!" : ""}`);
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
	const Mode: GameMode | undefined = GameModes.find((Candidate: GameMode): boolean =>
	{
		return Candidate.CommandName === Command;
	});

	if (Command === "class")
	{
		OpenClassMenu(Player.GetPlayerSlot());
	}
	else if (Command === "start")
	{
		EndWarmupNow(Player);
	}
	else if (Command === "spawntest" && bDebug)
	{
		const Pawn: CSPlayerPawn | undefined = Player.GetPlayerPawn();
		if (Pawn)
		{
			RunSpawnTest(Pawn);
		}
	}
	else if (PlayerClass !== undefined)
	{
		RequestPlayerClass(Player, PlayerClass);
	}
	else if (Mode !== undefined)
	{
		ChooseGameMode(Player, Mode);
	}
	else
	{
		Console.Log(`${LogPrefix} ${Player.GetPlayerName()} typed unknown command "${ChatCommandPrefix}${Command}"`);
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
	ShowBody(Pawn);
	ForgetSpawnZoneHistory(Slot);
	RefreshSpawnZoneTouches();
	GActiveMode.OnPlayerSpawn(Pawn, Slot);
	AssignRandomBotClass(Pawn, Slot);
	const bHadClass: boolean = GClassBySlot.has(Slot);
	ApplyPendingClass(Slot);
	RefreshClassUi(Pawn, Slot);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);

	SetTimer(MainSettings.LoadoutDelay, (): void =>
	{
		if (!Pawn.IsValid() || !Pawn.IsAlive() || GClassBySlot.get(Slot) !== PlayerClass)
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
		const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
		if (PlayerClass !== undefined && ClassDefinitions[PlayerClass].Settings.Model !== "")
		{
			SpawnGibs(Event.player);
			HideBody(Event.player);
		}
		const KillerSlot: number = GetPlayerSlot(Event.attacker);
		GActiveMode.OnPlayerKill(Slot, KillerSlot !== Slot ? KillerSlot : INDEX_NONE);
		ClearPlayer(Slot);
		RemoveBuildings(Slot);
		ForgetSpawnZonePlayer(Slot);
	}
}

function HandlePlayerDisconnect(Event: FPlayerDisconnectEvent): void
{
	ClearPlayer(Event.playerSlot);
	RemoveBuildings(Event.playerSlot);
	ForgetSpawnZonePlayer(Event.playerSlot);
	for (const Mode of GameModes)
	{
		Mode.OnPlayerLeave(Event.playerSlot);
	}
	ResetDamageNumbers(Event.playerSlot);
	ResetClassUi(Event.playerSlot);
	ForgetPlayerModel(Event.playerSlot);
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
	ClearBuildings();
	ResetHealthKits();
	ResetSpawnZones();
	SelectGameMode();
	GActiveMode.OnRoundStart();
	ApplyMatchSettings();
	Console.Log(`${LogPrefix} round has started [${GActiveMode.DisplayName}]`);
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
		Definition.OnPrimaryFire(Pawn, Slot, Instance.GetGameTime(), 0);
	}
	else if (IsWeapon(Weapon, Definition.Settings.Secondary) && !Definition.Settings.SecondaryLauncher)
	{
		Definition.OnSecondaryFire(Pawn, Slot, Instance.GetGameTime(), 0);
	}
}

function HandleKnifeAttack(Event: FKnifeAttackEvent): void
{
	const Pawn: CSPlayerPawn | undefined = Event.weapon.GetOwner();
	const Slot: number = GetPlayerSlot(Pawn);
	const PlayerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
	if (!Pawn || PlayerClass === undefined)
	{
		return;
	}
	const RepairPerHit: number | undefined = ClassDefinitions[PlayerClass].Settings.RepairPerHit;
	if (RepairPerHit !== undefined)
	{
		RepairBuildingInReach(Pawn, Slot, RepairPerHit, Instance.GetGameTime());
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
		RemoveDroppedWeapon(Weapon, Dropper);
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
	GActiveMode.OnPlayerDamage(GetPlayerSlot(Event.player), AttackerSlot, Event.damage);

	if (GetHeightAboveGround(Event.player, MainSettings.AirshotMinHeight) >= MainSettings.AirshotMinHeight)
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

// Match //////////////////////////////////////////////////////////////////////////////////////////

function SelectGameMode(): void
{
	const MapMode: GameMode | undefined = GameModes.find((Candidate: GameMode): boolean =>
	{
		return Entities.FindByName(`${MainSettings.MapModePrefix}${Candidate.CommandName}`).length > 0;
	});
	const Mode: GameMode = [GChosenMode, MapMode].find((Candidate: GameMode | undefined): boolean =>
	{
		return Candidate !== undefined && Candidate.IsMapSetUp();
	}) ?? GameModes.find((Candidate: GameMode): boolean =>
	{
		return Candidate.IsMapSetUp();
	}) ?? DefaultMode;

	if (Mode !== GActiveMode)
	{
		GActiveMode.OnDeactivated();
		GActiveMode = Mode;
		Mode.OnActivated();
		Console.Log(`${LogPrefix} activated ${Mode.DisplayName}`);
	}
}

function ChooseGameMode(Player: CSPlayerController, Mode: GameMode): void
{
	if (!Mode.IsMapSetUp())
	{
		Console.Log(`${LogPrefix} ${Player.GetPlayerName()} picked ${Mode.DisplayName}, but this map isn't set up for it`);
		return;
	}
	GChosenMode = Mode;
	Console.Log(`${LogPrefix} ${Player.GetPlayerName()} picked ${Mode.DisplayName}, restarting`);
	Console.ServerCommand("mp_restartgame 1");
}

function ApplyMatchSettings(): void
{
	const Commands: string[] = [];

	Commands.push("sv_infinite_ammo 0");
	Commands.push("mp_solid_teammates 0");

	if (bDebug)
	{
		Commands.push("mp_do_warmup_period 0", "mp_warmuptime 0", "mp_freezetime 0");
		Commands.push("bot_quota_mode fill", `bot_quota ${MainSettings.DebugBotQuota}`, "bot_join_team any");
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
	const bInSpawn: boolean = bAlive && Pawn !== undefined && IsInFriendlySpawnZone(Pawn, Slot);

	if (PlayerClass !== EPlayerClass.None && Pawn && Pawn.IsValid())
	{
		ClassDefinitions[PlayerClass].PlayPickFx(Pawn);
	}

	if (!bAlive || CurrentClass === EPlayerClass.None || ((bInSpawn || bDebug) && PlayerClass !== CurrentClass))
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
	ShowClassIndicator(Slot, CurrentClass, Pawn?.GetTeamNumber() === ETeam.Terrorist);
	Console.Log(`${LogPrefix} ${Player.GetPlayerName()} requested class ${PlayerClass}`);
}

function TickSpawnClassSwaps(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const NextClass: EPlayerClass | undefined = GPendingClassBySlot.get(Slot);
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (NextClass === undefined || !Controller || !IsInFriendlySpawnZone(Pawn, Slot))
		{
			return;
		}
		GPendingClassBySlot.delete(Slot);
		SetPlayerClass(Controller, NextClass);
	});
}

function ApplyPendingClass(Slot: number): void
{
	const NextClass: EPlayerClass | undefined = GPendingClassBySlot.get(Slot);
	if (NextClass === undefined)
	{
		return;
	}

	GPendingClassBySlot.delete(Slot);
	if (NextClass !== (GClassBySlot.get(Slot) ?? EPlayerClass.None))
	{
		RemoveBuildings(Slot);
	}
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
	if (PlayerClass !== (GClassBySlot.get(Slot) ?? EPlayerClass.None))
	{
		RemoveBuildings(Slot);
	}

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
	ShowClassIndicator(Slot, PlayerClass, Pawn?.GetTeamNumber() === ETeam.Terrorist);

	const ClassLabel: string = PlayerClass === EPlayerClass.None ? "normal" : PlayerClass;
	Console.Log(`${LogPrefix} ${Player.GetPlayerName()} set class to ${ClassLabel}`);
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
	ShowClassIndicator(Slot, PlayerClass, Pawn.GetTeamNumber() === ETeam.Terrorist);
	SetTimer(MainSettings.ClassMenuDelay, (): void =>
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
	ShowBuildings(Slot, []);
	ShowBuildHints(Slot, undefined);
	ShowTargetId(Slot, undefined);
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
			ShowBuildings(Slot, GetBuildingHudRows(Slot, Instance.GetGameTime()));
			const BuildKeys: FBuildKeys | undefined = PlayerClass !== undefined ? ClassDefinitions[PlayerClass].GetBuildKeys(Pawn) : undefined;
			ShowBuildHints(Slot, BuildKeys ? GetBuildHints(Slot, BuildKeys, Instance.GetGameTime()) : undefined);
			ShowTargetId(Slot, FindTargetId(Pawn, Slot));
			GActiveMode.TickPlayerHud(Pawn, Slot);
		}
	});
}

function FindTargetId(Pawn: CSPlayerPawn, Slot: number): FTargetId | undefined
{
	const ViewerClass: EPlayableClass | undefined = GClassBySlot.get(Slot);
	const HealTarget: CSPlayerPawn | undefined = ViewerClass !== undefined ? ClassDefinitions[ViewerClass].GetHealTarget(Slot) : undefined;
	if (HealTarget)
	{
		return GetPawnTargetId(HealTarget, Pawn);
	}
	const Eye: FVector = Pawn.GetEyePosition();
	const End: FVector = VectorMath.Add(Eye, VectorMath.Scale(VectorMath.GetForwardVector(Pawn.GetEyeAngles()), MainSettings.TargetIdRange));
	const Trace: TraceResult = Instance.TraceLine({ start: Eye, end: End, ignoreEntity: Pawn });
	const Turret: FBuilding | undefined = FindFriendlyTurret(Pawn, Eye, End, Trace);
	return Turret ? GetTurretTargetId(Turret) : GetPawnTargetId(Trace.hitEntity, Pawn);
}

function GetPawnTargetId(Target: Entity | undefined, Viewer: CSPlayerPawn): FTargetId | undefined
{
	if (!IsPlayerPawn(Target) || !Target.IsAlive() || !IsTeammate(Target, Viewer))
	{
		return undefined;
	}
	const TargetClass: EPlayableClass | undefined = GClassBySlot.get(GetPlayerSlot(Target));
	const Name: string = TargetClass !== undefined ? `${GetPawnName(Target)} (${ClassDefinitions[TargetClass].Settings.DisplayName})` : GetPawnName(Target);
	const MaxHealth: number = Target.GetMaxHealth();
	return { Name: Name, Health: Target.GetHealth(), MaxHealth: MaxHealth, MaxOverheal: Math.floor(MaxHealth * MedicSettings.OverhealMult), bTerrorist: Target.GetTeamNumber() === ETeam.Terrorist };
}

function GetTurretTargetId(Turret: FBuilding): FTargetId
{
	const MaxHealth: number = Turret.Kind.Settings.Health;
	const Name: string = `${GetPawnName(Turret.Owner)}'s ${Turret.Kind.Settings.DisplayName}`;
	return { Name: Name, Health: Math.max(0, Math.ceil(Turret.Health)), MaxHealth: MaxHealth, MaxOverheal: MaxHealth, bTerrorist: Turret.Team === ETeam.Terrorist };
}

function FindFriendlyTurret(Viewer: CSPlayerPawn, Eye: FVector, End: FVector, Trace: TraceResult): FBuilding | undefined
{
	const IsFriendlyTurret: (Building: FBuilding) => boolean = (Building: FBuilding): boolean =>
	{
		return Building.Kind instanceof TurretKind && !Building.bRemoved && !IsBuildingEnemy(Building, Viewer);
	};
	const Struck: FBuilding | undefined = GetTraceBuilding(Trace);
	if (Struck)
	{
		return IsFriendlyTurret(Struck) ? Struck : undefined;
	}
	const Hit: FBuildingHit | undefined = TraceBuildings(Eye, End, 0, IsFriendlyTurret);
	return Hit && (!Trace.didHit || Hit.Fraction <= Trace.fraction) ? Hit.Building : undefined;
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

function RemoveDroppedWeapon(Weapon: CSWeaponBase, Dropper: CSPlayerPawn): void
{
	if (!Weapon.IsValid() || Weapon.GetOwner())
	{
		return;
	}
	const Data: CSWeaponData | undefined = Weapon.GetData();
	const ItemName: string = Data ? Data.GetName() : Weapon.GetClassName();
	const bGiveBack: boolean = Dropper.IsValid() && Dropper.IsAlive() && IsWeaponAllowed(GClassBySlot.get(GetPlayerSlot(Dropper)) ?? EPlayerClass.None, Weapon);
	Weapon.Remove();
	if (bGiveBack)
	{
		Dropper.GiveNamedItem(ItemName, true);
	}
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
