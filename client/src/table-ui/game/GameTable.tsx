"use client";

import { useState, useEffect, useRef } from "react";
import type { GameState, Card, Suit, Player, CompletedTrick, Bot } from '../../types/game';
import type { ChatMessage } from '../Chat';
import Chat from '../Chat';
import HandSummaryModal from './HandSummaryModal';
import WinnerModal from './WinnerModal';
import LoserModal from './LoserModal';
import BiddingInterface from './BiddingInterface';
import { calculateHandScore } from '../../lib/scoring';
import LandscapePrompt from '../../LandscapePrompt';
import { IoExitOutline, IoInformationCircleOutline } from "react-icons/io5";
import { useWindowSize } from '../../hooks/useWindowSize';
import { FaRobot } from 'react-icons/fa';
import { FaMinus } from 'react-icons/fa';
import { useSocket } from '../../context/SocketContext';

interface GameTableProps {
  game: GameState;
  joinGame: (gameId: string, userId: string, options?: any) => void;
  onLeaveTable: () => void;
  startGame: (gameId: string, userId?: string) => Promise<void>;
  user?: any;
}

// Helper function to get card image filename
function getCardImage(card: Card): string {
  if (!card) return 'back.png';
  // Accepts suit as symbol, letter, or word
  const suitMap: Record<string, string> = {
    '♠': 'S', 'Spades': 'S', 'S': 'S',
    '♥': 'H', 'Hearts': 'H', 'H': 'H',
    '♦': 'D', 'Diamonds': 'D', 'D': 'D',
    '♣': 'C', 'Clubs': 'C', 'C': 'C',
  };
  const suitLetter = suitMap[card.suit] || card.suit || 'X';
  return `${card.rank}${suitLetter}.png`;
}

// Helper function to get card rank value
function getCardValue(rank: string | number): number {
  // If rank is already a number, return it
  if (typeof rank === 'number') {
    return rank;
  }
  
  // Otherwise, convert string ranks to numbers
  const rankMap: { [key: string]: number } = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return rankMap[rank];
}

// Helper function to sort cards
function sortCards(cards: Card[]): Card[] {
  // Suit order: Diamonds, Clubs, Hearts, Spades
  const suitOrder: Record<string, number> = { '♦': 0, 'C': 1, '♣': 1, '♥': 2, 'H': 2, '♠': 3, 'S': 3 };
  return [...cards].sort((a, b) => {
    // Normalize suit to single letter for sorting
    const getSuitKey = (suit: string) => {
      if (suit === '♦' || suit === 'Diamonds' || suit === 'D') return '♦';
      if (suit === '♣' || suit === 'Clubs' || suit === 'C') return '♣';
      if (suit === '♥' || suit === 'Hearts' || suit === 'H') return '♥';
      if (suit === '♠' || suit === 'Spades' || suit === 'S') return '♠';
      return suit;
    };
    const suitA = getSuitKey(a.suit);
    const suitB = getSuitKey(b.suit);
    if (suitOrder[suitA] !== suitOrder[suitB]) {
      return suitOrder[suitA] - suitOrder[suitB];
    }
    return getCardValue(a.rank) - getCardValue(b.rank);
  });
}

// Add new helper functions after the existing ones
function getLeadSuit(trick: Card[]): Suit | null {
  return trick[0]?.suit || null;
}

function hasSpadeBeenPlayed(game: GameState): boolean {
  // Check if any completed trick contained a spade
  return game.completedTricks?.some((trick: any) =>
    Array.isArray(trick.cards) && trick.cards.some((card: Card) => card.suit === '♠')
  ) || false;
}

function canLeadSpades(game: GameState, hand: Card[]): boolean {
  // Can lead spades if:
  // 1. Spades have been broken, or
  // 2. Player only has spades left
  return hasSpadeBeenPlayed(game) || hand.every(card => card.suit === '♠');
}

function getPlayableCards(game: GameState, hand: Card[], isLeadingTrick: boolean): Card[] {
  if (!hand.length) return [];

  // If leading the trick
  if (isLeadingTrick) {
    // If spades haven't been broken, filter out spades unless only spades remain
    if (!canLeadSpades(game, hand)) {
      const nonSpades = hand.filter(card => card.suit !== '♠');
      return nonSpades.length > 0 ? nonSpades : hand;
    }
    return hand;
  }

  // If following
  const leadSuit = getLeadSuit(game.currentTrick);
  if (!leadSuit) return [];

  // Must follow suit if possible
  const suitCards = hand.filter(card => card.suit === leadSuit);
  return suitCards.length > 0 ? suitCards : hand;
}

// Add this near the top of the file, after imports
declare global {
  interface Window {
    lastCompletedTrick: {
      cards: Card[];
      winnerIndex: number;
      timeout: any;
    } | null;
    __sentJoinSystemMessage: string | null;
  }
}

// Helper function to count spades in a hand
const countSpades = (hand: Card[]): number => {
  return hand.filter(card => card.suit === '♠').length;
};

// Helper function to determine if the current user can invite a bot for a seat
function canInviteBot({
  gameState,
  currentPlayerId,
  seatIndex,
  isPreGame,
  sanitizedPlayers,
}: {
  gameState: GameState;
  currentPlayerId: string;
  seatIndex: number;
  isPreGame: boolean;
  sanitizedPlayers: (Player | null)[];
}) {
  if (!currentPlayerId) return false;
  if (isPreGame) {
    // Only host (seat 0) can invite bots pre-game
    return sanitizedPlayers[0]?.id === currentPlayerId && gameState.status === 'WAITING';
  } else {
    // Mid-game: only the partner of the empty seat can invite a bot
    // Partner is seat (seatIndex + 2) % 4
    const partnerIndex = (seatIndex + 2) % 4;
    return sanitizedPlayers[partnerIndex]?.id === currentPlayerId && gameState.status === 'PLAYING';
  }
}

// Type guards for Player and Bot
function isPlayer(p: Player | Bot | null): p is Player {
  return !!p && typeof p === 'object' && ((('type' in p) && p.type !== 'bot') || !('type' in p));
}
function isBot(p: Player | Bot | null): p is Bot {
  return !!p && typeof p === 'object' && 'type' in p && p.type === 'bot';
}

// Add this utility function at the top (after imports)
const formatCoins = (value: number) => {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  return `${value / 1000}k`;
};

export default function GameTable({ 
  game, 
  joinGame, 
  onLeaveTable,
  startGame,
  user: propUser
}: GameTableProps) {
  const { socket, isAuthenticated } = useSocket();
  const [isMobile, setIsMobile] = useState(false);
  const [showHandSummary, setShowHandSummary] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const [showLoser, setShowLoser] = useState(false);
  
  // Use the windowSize hook to get responsive information
  const windowSize = useWindowSize();
  
  // Add state to directly track which player played which card
  const [cardPlayers, setCardPlayers] = useState<{[key: string]: string}>({});
  
  const user = propUser;
  
  // Use gameState for all game data
  const [gameState, setGameState] = useState(game);
  
  // Use gameState instead of game
  const currentTrick = gameState.currentTrick || [];
  
  // Find the current player's ID
  const currentPlayerId = user?.id;
  
  // After getting the players array:
  const sanitizedPlayers = (gameState.players || []);
  const isObserver = !sanitizedPlayers.some((p): p is Player | Bot => !!p && p.id === currentPlayerId);
  console.log('game.players:', gameState.players); // Debug log to catch nulls

  // Find the current player's position and team
  const currentPlayer = sanitizedPlayers.find((p): p is Player | Bot => !!p && p.id === currentPlayerId) || null;
  
  // Add state to force component updates when the current player changes
  const [lastCurrentPlayer, setLastCurrentPlayer] = useState<string>(gameState.currentPlayer);
  
  // Track all game state changes that would affect the UI
  useEffect(() => {
    if (lastCurrentPlayer !== gameState.currentPlayer) {
      console.log(`Current player changed: ${lastCurrentPlayer} -> ${gameState.currentPlayer} (my ID: ${currentPlayerId})`);
      setLastCurrentPlayer(gameState.currentPlayer);
      
      // Force a component state update to trigger re-renders of children
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('gameStateChanged'));
      }
    }
  }, [gameState.currentPlayer, lastCurrentPlayer, currentPlayerId]);

  // Use the explicit position property if available, otherwise fall back to array index
  // @ts-ignore - position property might not be on the type yet
  const currentPlayerPosition = currentPlayer?.position !== undefined ? currentPlayer.position : sanitizedPlayers.findIndex((p: Player | null) => p && p.id === currentPlayerId);

  // FIXED ROTATION: Always put current player at bottom (South)
  const rotatePlayersForCurrentView = () => {
    // Find the current player's position
    const currentPlayerPosition = currentPlayer?.position ?? 0;
    
    // Create a rotated array where current player is at position 0 (South)
    const rotatedPlayers = sanitizedPlayers.map((player) => {
      if (!player) return null;
      // Calculate new position: (4 + originalPos - currentPlayerPosition) % 4
      // This ensures current player is at 0, and others are rotated accordingly
      const newPosition = (4 + (player.position ?? 0) - currentPlayerPosition) % 4;
      return { ...player, displayPosition: newPosition } as (Player | Bot) & { displayPosition: number };
    });
    
    // Create final array with players in their display positions
    const positions = Array(4).fill(null);
    rotatedPlayers.forEach((player) => {
      if (player && player.displayPosition !== undefined) {
        positions[player.displayPosition] = player;
      }
    });
    
    return positions;
  };

  // Preserve original positions in the array so the server knows where everyone sits
  const orderedPlayers = rotatePlayersForCurrentView();

  // Keep the getScaleFactor function
  const getScaleFactor = () => {
    // Don't scale on mobile
    if (windowSize.width < 640) return 1;
    
    // Base scale on the screen width compared to a reference size
    const referenceWidth = 1200; // Reference width for desktop
    let scale = Math.min(1, windowSize.width / referenceWidth);
    
    // Minimum scale to ensure things aren't too small
    return Math.max(0.6, scale);
  };
  
  // Calculate scaleFactor once based on window size
  const scaleFactor = getScaleFactor();
  
  // Update isMobile based on windowSize
  useEffect(() => {
    setIsMobile(windowSize.isMobile);
  }, [windowSize.isMobile]);

  const handleBid = (bid: number) => {
    if (!currentPlayerId || !currentPlayer) {
      console.error('Cannot bid: No current player or player ID');
      return;
    }
    
    // Validate that it's actually this player's turn
    if (gameState.currentPlayer !== currentPlayerId) {
      console.error(`Cannot bid: Not your turn. Current player is ${gameState.currentPlayer}`);
      return;
    }
    
    // Validate game state
    if (gameState.status !== 'BIDDING') {
      console.error(`Cannot bid: Game is not in bidding state (${gameState.status})`);
      return;
    }
    
    console.log(`Submitting bid: ${bid} for player ${currentPlayerId} in game ${gameState.id}`);
    socket?.emit("make_bid", { gameId: gameState.id, userId: currentPlayerId, bid });
    console.log('Game status:', gameState.status, 'Current player:', gameState.currentPlayer);
    console.log('Socket connected:', socket?.connected);
  };

  // Add at the top of the GameTable component, after useState declarations
  const [invitingBotSeat, setInvitingBotSeat] = useState<number | null>(null);

  const handleInviteBot = async (seatIndex: number) => {
    setInvitingBotSeat(seatIndex);
    try {
      const endpoint = gameState.status === 'WAITING'
        ? `/api/games/${gameState.id}/invite-bot`
        : `/api/games/${gameState.id}/invite-bot-midgame`;
      
      console.log('Inviting bot to seat:', seatIndex);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatIndex, requesterId: currentPlayerId }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        console.error('Failed to invite bot:', error);
        alert('Failed to invite bot: ' + (error.error || 'Unknown error'));
      } else {
        const updatedGame = await res.json();
        console.log('Bot invited successfully:', updatedGame);
        setGameState(updatedGame);
        setPendingSystemMessage(`A bot was invited to seat ${seatIndex + 1}.`);
      }
    } catch (err) {
      console.error('Error inviting bot:', err);
      alert('Failed to invite bot');
    } finally {
      setInvitingBotSeat(null);
    }
  };

  // Add remove bot handler
  const handleRemoveBot = async (seatIndex: number) => {
    try {
      const endpoint = gameState.status === 'WAITING'
        ? `/api/games/${gameState.id}/remove-bot`
        : `/api/games/${gameState.id}/remove-bot-midgame`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatIndex, requesterId: currentPlayerId }),
      });
      if (!res.ok) {
        const error = await res.json();
        alert('Failed to remove bot: ' + (error.error || 'Unknown error'));
      } else {
        // Update the local game state with the new data from the server
        const updatedGame = await res.json();
        setGameState(updatedGame);
        setPendingSystemMessage(`A bot was removed from seat ${seatIndex + 1}.`);
      }
    } catch (err) {
      alert('Failed to remove bot');
    }
  };

  // Update the player tricks display
  const renderPlayerPosition = (position: number) => {
    const player = orderedPlayers[position];
    // Define getPositionClasses FIRST
    const getPositionClasses = (pos: number): string => {
      // Base positioning
      const basePositions = [
        'bottom-4 left-1/2 -translate-x-1/2',  // South (bottom)
        'left-4 top-1/2 -translate-y-1/2',     // West (left)
        'top-4 left-1/2 -translate-x-1/2',     // North (top)
        'right-4 top-1/2 -translate-y-1/2'     // East (right)
      ];
      
      // Apply responsive adjustments
      if (windowSize.width < 768) {
        // Tighter positioning for smaller screens
        const mobilePositions = [
          'bottom-2 left-1/2 -translate-x-1/2',  // South
          'left-2 top-1/2 -translate-y-1/2',     // West
          'top-2 left-1/2 -translate-x-1/2',     // North
          'right-2 top-1/2 -translate-y-1/2'     // East
        ];
        return mobilePositions[pos];
      }
      
      return basePositions[pos];
    };

    console.log('Rendering player position', position, player);
    // If observer and seat is empty, show join button
    if (isObserver && !player) {
      return (
        <div className={`absolute ${getPositionClasses(position)} z-10`}>
          <button
            className="w-16 h-16 rounded-full bg-slate-600 border border-slate-300 text-slate-200 text-base flex items-center justify-center hover:bg-slate-500 transition"
            onClick={() => joinGame(gameState.id, user.id, { seat: position, username: user.username, avatar: user.avatar })}
          >
            JOIN
          </button>
        </div>
      );
    }
    // If seat is empty and user can invite a bot, show Invite Bot button
    if (!player && currentPlayerId && canInviteBot({
      gameState,
      currentPlayerId,
      seatIndex: position,
      isPreGame: gameState.status === 'WAITING',
      sanitizedPlayers: sanitizedPlayers.filter((p): p is Player | null => isPlayer(p) || p === null),
    })) {
      return (
        <div className={`absolute ${getPositionClasses(position)} z-10`}>
          <button
            className="w-16 h-16 rounded-full bg-gray-600 border border-slate-300 text-white flex flex-col items-center justify-center hover:bg-gray-500 transition disabled:opacity-50 p-0 py-1"
            onClick={() => handleInviteBot(position)}
            disabled={invitingBotSeat === position}
            style={{ fontSize: '10px', lineHeight: 1.1 }}
          >
            <span className="text-[10px] leading-tight mb-0">Invite</span>
            <span className="flex items-center justify-center my-0">
              <span className="text-lg font-bold mr-0.5">+</span>
              <FaRobot className="w-4 h-4" />
            </span>
            <span className="text-[10px] leading-tight mt-0">{invitingBotSeat === position ? '...' : 'Bot'}</span>
          </button>
        </div>
      );
    }
    // If seat is empty and user cannot invite a bot, show nothing
    if (!player) return null;

    // Shared variables for both bots and humans
    const isActive = gameState.status !== "WAITING" && gameState.currentPlayer === player.id;
    const isSideSeat = position === 1 || position === 3;
    const avatarWidth = isMobile ? 32 : 40;
    const avatarHeight = isMobile ? 32 : 40;
    const redTeamGradient = "bg-gradient-to-r from-red-700 to-red-500";
    const blueTeamGradient = "bg-gradient-to-r from-blue-700 to-blue-500";
    const teamGradient = (position === 0 || position === 2)
      ? blueTeamGradient
      : redTeamGradient;
    // Calculate bid/made/tick/cross logic for both bots and humans
    const madeCount = player.tricks || 0;
    const bidCount = player.bid !== undefined ? player.bid : 0;
    let madeStatus = null;
    const tricksLeft = 13 - (gameState.completedTricks?.length || 0);
    const isPartnerGame = (gameState.gameMode || gameState.rules?.gameType) === 'PARTNERS';
    const isSoloGame = (gameState.gameMode || gameState.rules?.gameType) === 'SOLO';
    // Find partner (for 4p, partner is (position+2)%4)
    let teamBid = bidCount;
    let teamMade = madeCount;
    if (isPartnerGame) {
      const partnerIndex = (position + 2) % 4;
      const partner = orderedPlayers[partnerIndex];
      const partnerBid = partner && partner.bid !== undefined ? partner.bid : 0;
      const partnerMade = partner && partner.tricks ? partner.tricks : 0;
      teamBid += partnerBid;
      teamMade += partnerMade;
      // Nil logic: if player bid 0 (nil) and made > 0, show cross for that player only
      if (bidCount === 0 && madeCount > 0) {
        madeStatus = '❌';
      } else if (teamMade >= teamBid && teamBid > 0) {
        madeStatus = '✅';
      } else if (teamMade + tricksLeft < teamBid && teamBid > 0) {
        madeStatus = '❌';
      } else {
        madeStatus = null;
      }
    } else if (isSoloGame) {
      // Solo: tick/cross only for self
      if (bidCount === 0 && madeCount > 0) {
        madeStatus = '❌';
      } else if (madeCount >= bidCount && bidCount > 0) {
        madeStatus = '✅';
      } else if (madeCount + tricksLeft < bidCount && bidCount > 0) {
        madeStatus = '❌';
      } else {
        madeStatus = null;
      }
    } else {
      // Fallback: hide
      madeStatus = null;
    }
    // --- END NEW LOGIC ---

    // Permission to remove bot: host (pre-game) or partner (mid-game)
    const canRemoveBot = (() => {
      if (!currentPlayerId) return false;
      if (gameState.status === 'WAITING') {
        // Host (seat 0) can always remove bots pre-game
        return sanitizedPlayers[0]?.id === currentPlayerId;
      } else {
        // Mid-game: partner (seat (position+2)%4) can remove bots
        const partnerIndex = (position + 2) % 4;
        return sanitizedPlayers[partnerIndex]?.id === currentPlayerId;
      }
    })();
    return (
      <div className={`absolute ${getPositionClasses(position)} z-30`}>
        <div className={`
          backdrop-blur-sm bg-white/10 rounded-xl overflow-hidden
          ${isActive ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/30' : 'shadow-md'}
          transition-all duration-200
        `}>
          <div className={isSideSeat ? "flex flex-col items-center p-1.5 gap-1.5" : "flex items-center p-1.5 gap-1.5"}>
            <div className="relative">
              <div className="rounded-full overflow-hidden p-0.5 bg-gradient-to-r from-gray-400 to-gray-600">
                <div className="bg-gray-900 rounded-full p-0.5">
                  <img
                    src={player.avatar || '/bot-avatar.jpg'}
                    alt="Bot"
                    width={avatarWidth}
                    height={avatarHeight}
                    className="rounded-full object-cover"
                  />
                  {canRemoveBot && (
                    <button
                      className="absolute -bottom-1 -left-1 w-4 h-4 bg-red-600 text-white rounded-full flex items-center justify-center text-xs border-2 border-white shadow hover:bg-red-700 transition z-50"
                      title="Remove Bot"
                      onClick={() => handleRemoveBot(position)}
                      style={{ zIndex: 50 }}
                    >
                      <FaMinus className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {/* Dealer chip for bots */}
                  {player.isDealer && (
                    <>
                      {(() => { console.log('Rendering dealer chip for', player.username, player.isDealer); return null; })()}
                      <div className="absolute -bottom-1 -right-1">
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-r from-yellow-300 to-yellow-500 shadow-md">
                          <div className="w-4 h-4 rounded-full bg-yellow-600 flex items-center justify-center">
                            <span className="text-[8px] font-bold text-yellow-200">D</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-full px-2 py-1 rounded-lg shadow-sm ${teamGradient}`} style={{ width: isMobile ? '50px' : '70px' }}>
                <div className="text-white font-medium truncate text-center" style={{ fontSize: isMobile ? '9px' : '11px' }}>
                  Bot
                </div>
              </div>
              {/* Bid/Trick counter for bots, same as humans */}
              <div className="backdrop-blur-md bg-white/20 rounded-full px-2 py-0.5 shadow-inner flex items-center justify-center gap-1"
                   style={{ width: isMobile ? '50px' : '70px' }}>
                <span style={{ fontSize: isMobile ? '9px' : '11px', fontWeight: 600 }}>
                  {gameState.status === "WAITING" ? "0" : madeCount}
                </span>
                <span className="text-white/70" style={{ fontSize: isMobile ? '9px' : '11px' }}>/</span>
                <span className="text-white font-semibold" style={{ fontSize: isMobile ? '9px' : '11px' }}>
                  {gameState.status === "WAITING" ? "0" : bidCount}
                </span>
                <span style={{ fontSize: isMobile ? '10px' : '12px' }} className="ml-1">
                  {madeStatus}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Card dealing animation state ---
  const [handImagesLoaded, setHandImagesLoaded] = useState(false);
  const [dealtCardCount, setDealtCardCount] = useState(0);
  const handImageRefs = useRef<{ [key: string]: boolean }>({});
  const dealTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Preload card images when hand changes
  useEffect(() => {
    if (!currentPlayer || !currentPlayer.hand) {
      setHandImagesLoaded(false);
      setDealtCardCount(0);
      handImageRefs.current = {};
      return;
    }
    const sortedHand = sortCards(currentPlayer.hand);
    let loadedCount = 0;
    handImageRefs.current = {};
    setHandImagesLoaded(false);
    setDealtCardCount(0);
    sortedHand.forEach((card) => {
      const img = new window.Image();
      img.src = `/cards/${getCardImage(card)}`;
      img.onload = () => {
        handImageRefs.current[`${card.suit}${card.rank}`] = true;
        loadedCount++;
        if (loadedCount === sortedHand.length) {
          setHandImagesLoaded(true);
        }
      };
      img.onerror = () => {
        handImageRefs.current[`${card.suit}${card.rank}`] = false;
        loadedCount++;
        if (loadedCount === sortedHand.length) {
          setHandImagesLoaded(true);
        }
      };
    });
    // Cleanup on hand change
    return () => {
      if (dealTimeoutRef.current) clearTimeout(dealTimeoutRef.current);
    };
  }, [currentPlayer && currentPlayer.hand && currentPlayer.hand.map(c => `${c.suit}${c.rank}`).join(",")]);

  // Animate dealing cards after images are loaded
  useEffect(() => {
    if (!handImagesLoaded || !currentPlayer || !currentPlayer.hand) return;
    setDealtCardCount(0);
    const sortedHand = sortCards(currentPlayer.hand);
    function dealNext(idx: number) {
      setDealtCardCount(idx + 1);
      if (idx + 1 < sortedHand.length) {
        dealTimeoutRef.current = setTimeout(() => dealNext(idx + 1), 100);
      }
    }
    dealTimeoutRef.current = setTimeout(() => dealNext(0), 100);
    return () => {
      if (dealTimeoutRef.current) clearTimeout(dealTimeoutRef.current);
    };
  }, [handImagesLoaded, currentPlayer && currentPlayer.hand && currentPlayer.hand.map(c => `${c.suit}${c.rank}`).join(",")]);

  const renderPlayerHand = () => {
    if (!currentPlayer || !currentPlayer.hand) return null;
    const sortedHand = sortCards(currentPlayer.hand);
    if (!handImagesLoaded) {
      return null;
    }
    // All cards are in their final positions, but only the first dealtCardCount are visible
    const isLeadingTrick = currentTrick.length === 0;
    const playableCards = gameState.status === "PLAYING" && currentPlayer ? getPlayableCards(gameState, currentPlayer.hand || [], isLeadingTrick) : [];
    const cardUIWidth = Math.floor(isMobile ? 80 : 100 * scaleFactor);
    const cardUIHeight = Math.floor(isMobile ? 110 : 140 * scaleFactor);
    const overlapOffset = Math.floor(isMobile ? -48 : -40 * scaleFactor);

    return (
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{
          bottom: '-40px',
          pointerEvents: 'none',
        }}
      >
        <div className="flex">
          {sortedHand.map((card: Card, index: number) => {
            const isPlayable = gameState.status === "PLAYING" &&
              gameState.currentPlayer === currentPlayerId &&
              playableCards.some((c: Card) => c.suit === card.suit && c.rank === card.rank);
            const isVisible = index < dealtCardCount;
            return (
              <div
                key={`${card.suit}${card.rank}`}
                className={`relative transition-opacity duration-300 ${isPlayable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                style={{
                  width: `${cardUIWidth}px`,
                  height: `${cardUIHeight}px`,
                  marginLeft: index > 0 ? `${overlapOffset}px` : '0',
                  zIndex: index,
                  pointerEvents: 'auto',
                  opacity: isVisible ? 1 : 0,
                }}
                onClick={() => isPlayable && handlePlayCard(card)}
              >
                <div className="relative">
                  <img
                    src={`/cards/${getCardImage(card)}`}
                    alt={`${card.rank}${card.suit}`}
                    width={cardUIWidth}
                    height={cardUIHeight}
                    className={`rounded-lg shadow-md ${isPlayable ? 'hover:shadow-lg' : ''}`}
                    style={{ objectFit: 'cover' }}
                  />
                  {!isPlayable && (
                    <div className="absolute inset-0 bg-gray-600/40 rounded-lg" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Effect to handle hand completion
  useEffect(() => {
    if (!socket) return;

    // Listen for hand completion event
    const handleHandCompleted = () => {
      console.log('Hand completed - calculating scores for display');
      
      // Calculate scores using the scoring algorithm
      const onlyPlayers = sanitizedPlayers.filter(isPlayer);
      const calculatedScores = calculateHandScore(onlyPlayers);
      
      console.log('Hand scores calculated:', calculatedScores);
      
      // Set the hand scores and show the modal
      setShowHandSummary(true);
    };
    
    // Register event listener for hand completion
    socket.on('hand_completed', handleHandCompleted);
    
    // Handle scoring state change directly in case the server doesn't emit the event
    if (gameState.status === "PLAYING" && (sanitizedPlayers.filter(isPlayer) as Player[]).every((p) => p.hand.length === 0) && !showHandSummary) {
      handleHandCompleted();
    }
    
    return () => {
      socket.off('hand_completed', handleHandCompleted);
    };
  }, [socket, gameState.id, gameState.status, sanitizedPlayers, showHandSummary]);

  // Initialize the global variable
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.lastCompletedTrick = null;
    }
  }, []);

  // Calculate scores
  const team1Score = gameState?.scores?.['team1'] ?? 0;
  const team2Score = gameState?.scores?.['team2'] ?? 0;
  const team1Bags = gameState?.team1Bags ?? 0;
  const team2Bags = gameState?.team2Bags ?? 0;

  // Update cardPlayers when game state changes
  useEffect(() => {
    if (gameState.cardPlayers) {
      setCardPlayers(gameState.cardPlayers);
    }
  }, [gameState.cardPlayers]);

  // Effect to handle game completion
  useEffect(() => {
    if (!socket) return;

    const handleGameOver = (data: { team1Score: number; team2Score: number; winningTeam: 1 | 2 }) => {
      console.log('Game over event received:', data);
      setShowHandSummary(false);
      if (data.winningTeam === 1) {
        setShowWinner(true);
      } else {
        setShowLoser(true);
      }
    };

    socket.on('game_over', handleGameOver);

    return () => {
      socket.off('game_over', handleGameOver);
    };
  }, [socket]);

  // Effect to handle game status changes
  useEffect(() => {
    if (gameState.status === "COMPLETED") {
      const winningTeam = gameState.winningTeam === "team1" ? 1 : 2;
      setShowHandSummary(false);
      if (winningTeam === 1) {
        setShowWinner(true);
      } else {
        setShowLoser(true);
      }
    }
  }, [gameState.status, gameState.winningTeam]);

  const [showGameInfo, setShowGameInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(event.target as Node)) {
        setShowGameInfo(false);
      }
    }
    if (showGameInfo) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showGameInfo]);

  // Modify the renderTrickCards function
  const renderTrickCards = () => {
    // Use completed trick if available, otherwise use current trick
    const displayTrick = completedTrick ? completedTrick.cards : currentTrick;
    if (!displayTrick?.length) return null;

    return displayTrick.map((card: Card, index: number) => {
      if (!card.playedBy) {
        console.error(`Card ${card.rank}${card.suit} is missing playedBy information`);
        return null;
      }

      const relativePosition = (4 + card.playedBy.position - (currentPlayerPosition ?? 0)) % 4;

      const positions: Record<number, string> = windowSize.width < 640 ? {
        0: 'absolute bottom-16 left-1/2 transform -translate-x-1/2',
        1: 'absolute left-8 top-1/2 transform -translate-y-1/2',
        2: 'absolute top-16 left-1/2 transform -translate-x-1/2',
        3: 'absolute right-8 top-1/2 transform -translate-y-1/2'
      } : {
        0: 'absolute bottom-[20%] left-1/2 transform -translate-x-1/2',
        1: 'absolute left-[20%] top-1/2 transform -translate-y-1/2',
        2: 'absolute top-[20%] left-1/2 transform -translate-x-1/2',
        3: 'absolute right-[20%] top-1/2 transform -translate-y-1/2'
      };

      const isWinningCard = completedTrick && 
        card.suit === completedTrick.winningCard.suit && 
        card.rank === completedTrick.winningCard.rank;

      // Calculate card dimensions using the same approach as player's hand
      const cardUIWidth = windowSize.width < 640 ? 25 : Math.floor(96 * getScaleFactor());
      const cardUIHeight = windowSize.width < 640 ? 38 : Math.floor(144 * getScaleFactor());

      return (
        <div
          key={`${card.suit}-${card.rank}-${index}`}
          className={`${positions[relativePosition]} z-10 transition-all duration-500
            ${isWinningCard ? 'ring-2 ring-yellow-400 scale-110 z-20' : ''}`}
          style={{
            width: `${cardUIWidth}px`,
            height: `${cardUIHeight}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 'unset'
          }}
        >
          <img
            src={`/cards/${getCardImage(card)}`}
            alt={`${card.rank} of ${card.suit}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain'
            }}
          />
          {isWinningCard && (
            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 
              bg-yellow-400 text-black font-bold rounded-full px-3 py-1
              animate-bounce">
              +1
            </div>
          )}
        </div>
      );
    }).filter(Boolean);
  };

  const handlePlayAgain = () => {
    if (!socket) return;
    socket.emit('play_again', { gameId: gameState.id });
  };

  useEffect(() => {
    if (!socket) return;

    socket.on('player_wants_to_play_again', (data: { playerId: string }) => {
      setCardPlayers(prev => ({ ...prev, [data.playerId]: data.playerId }));
    });

    socket.on('game_restarting', () => {
      setCardPlayers({});
      setShowHandSummary(false);
      setShowWinner(false);
      setShowLoser(false);
      if (socket) {
        socket.emit('leave_game', { gameId: gameState.id, userId: propUser?.id });
      }
      onLeaveTable();
    });

    return () => {
      socket.off('player_wants_to_play_again');
      socket.off('game_restarting');
    };
  }, [socket, propUser?.id, onLeaveTable]);

  // Add state for trick completion animation
  const [completedTrick, setCompletedTrick] = useState<CompletedTrick | null>(null);

  // Effect to handle trick completion
  useEffect(() => {
    if (!socket) return;

    const handleTrickComplete = (data: CompletedTrick) => {
      setCompletedTrick(data);
      
      // Clear completed trick after delay
      const timer = setTimeout(() => {
        setCompletedTrick(null);
      }, 3000);

      return () => clearTimeout(timer);
    };

    socket.on('trick_complete', handleTrickComplete);

    return () => {
      socket.off('trick_complete', handleTrickComplete);
    };
  }, [socket]);

  // When playing a card, we now rely solely on server data for tracking
  const handlePlayCard = (card: Card) => {
    if (!socket || !currentPlayerId || !currentPlayer) return;

    // Validate if it's player's turn
    if (gameState.currentPlayer !== currentPlayerId) {
      console.error(`Cannot play card: Not your turn`);
      return;
    }

    // Check if card is playable
    const isLeadingTrick = currentTrick.length === 0;
    const playableCards = currentPlayer ? getPlayableCards(gameState, currentPlayer.hand, isLeadingTrick) : [];
    if (!playableCards.some((c: Card) => c.suit === card.suit && c.rank === card.rank)) {
      console.error('This card is not playable in the current context');
      return;
    }

    console.log(`Playing card: ${card.rank}${card.suit} as player ${isPlayer(currentPlayer) ? currentPlayer.name : isBot(currentPlayer) ? currentPlayer.username : 'Unknown'}`);
    
    // Update our local tracking immediately to know that current player played this card
    // This helps prevent the "Unknown" player issue when we play our own card
    const updatedMapping = { ...cardPlayers };
    updatedMapping[currentTrick.length.toString()] = currentPlayerId;
    setCardPlayers(updatedMapping);
    
    // Send the play to the server
    socket.emit("play_card", { 
      gameId: gameState.id, 
      userId: currentPlayerId, 
      card 
    });
  };

  const handleLeaveTable = () => {
    console.log("Leave Table clicked");
    console.log("Socket connected:", socket?.connected);
    if (socket) {
      socket.emit('leave_game', { gameId: gameState.id, userId: currentPlayerId });
    } else {
      console.error("Socket is undefined. Cannot emit leave_game event.");
    }
    onLeaveTable();
  };

  const handleStartGame = async () => {
    if (!currentPlayerId) return;
    
    // Make sure the game is in the WAITING state
    if (gameState.status !== "WAITING") {
      console.error(`Cannot start game: game is in ${gameState.status} state, not WAITING`);
      return;
    }
    
    // Make sure the game has enough players
    if (sanitizedPlayers.length < 4) {
      console.error(`Cannot start game: only ${sanitizedPlayers.length}/4 players joined`);
      return;
    }
    
    // Make sure current user is the creator (first player)
    if (sanitizedPlayers[0]?.id !== currentPlayerId) {
      console.error(`Cannot start game: current user ${currentPlayerId} is not the creator ${sanitizedPlayers[0]?.id}`);
      return;
    }
    
    try {
      console.log(`Starting game ${gameState.id} as user ${currentPlayerId}, creator: ${sanitizedPlayers[0]?.id}`);
      await startGame(gameState.id, currentPlayerId);
      setPendingSystemMessage('Game started! GOOD LUCK!');
    } catch (error) {
      console.error("Failed to start game:", error);
    }
  };

  // At the top of the component:
  const [pendingSystemMessage, setPendingSystemMessage] = useState<string | null>(null);

  // Add this useEffect:
  useEffect(() => {
    if (pendingSystemMessage && socket && isAuthenticated) {
      sendSystemMessage(pendingSystemMessage);
      setPendingSystemMessage(null);
    }
  }, [pendingSystemMessage, socket, isAuthenticated]);

  // --- Lobby chat toggle state ---
  const [chatType, setChatType] = useState<'game' | 'lobby'>('game');
  const [lobbyMessages, setLobbyMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!socket) return;
    const handleLobbyMsg = (msg: ChatMessage) => {
      setLobbyMessages(prev => [...prev, msg]);
    };
    socket.on('lobby_chat_message', handleLobbyMsg);
    return () => {
      socket.off('lobby_chat_message', handleLobbyMsg);
    };
  }, [socket]);

  // Loosen the chatReady guard so Chat UI renders as soon as gameState.id and currentPlayerId are available
  const chatReady = gameState?.id && currentPlayerId;

  // Add a new effect to handle socket reconnection and message sending
  useEffect(() => {
    if (!socket || !isAuthenticated || !gameState?.id || !user?.username) return;

    // Only send the join system message once per session
    if (window.__sentJoinSystemMessage !== gameState.id) {
      const systemMessage = {
        id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: 'system',
        userName: 'System',
        message: `${user.username} joined the game.`,
        timestamp: Date.now(),
        isGameMessage: true
      };
      socket.emit('chat_message', { gameId: gameState.id, message: systemMessage });
      window.__sentJoinSystemMessage = gameState.id;
    }
  }, [socket, isAuthenticated, gameState?.id, user?.username]);

  // Move sendSystemMessage definition inside GameTable, after useSocket and gameState
  const sendSystemMessage = (message: string) => {
    if (!socket || !isAuthenticated) {
      console.log('Socket not ready for system message:', { connected: socket?.connected, authenticated: isAuthenticated });
      return;
    }
    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId: 'system',
      userName: 'System',
      message,
      timestamp: Date.now(),
      isGameMessage: true
    };
    console.log('Sending system message:', systemMessage);
    socket.emit('chat_message', { gameId: gameState.id, message: systemMessage });
  };

  // After: const [gameState, setGameState] = useState(game);
  useEffect(() => {
    console.log('[DEBUG] GameTable received new game prop:', game);
    setGameState(game);
  }, [game]);

  // Return the JSX for the component
  return (
    <>
      <LandscapePrompt />
      <div className="fixed inset-0 overflow-hidden bg-gray-900">
        {/* Main content area - full height */}
        <div className="flex h-full overflow-hidden">
          {/* Game table area - add padding on top and bottom */}
          <div className="w-[70%] p-2 flex flex-col h-full overflow-hidden">
            {/* Game table with more space top and bottom */}
            <div className="relative mb-2 overflow-hidden" style={{ 
              background: 'radial-gradient(circle at center, #316785 0%, #1a3346 100%)',
              borderRadius: `${Math.floor(64 * scaleFactor)}px`,
              border: `${Math.floor(2 * scaleFactor)}px solid #855f31`,
              height: '100%'
            }}>
              {/* Leave Table button - inside table in top left corner */}
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                <button
                  onClick={handleLeaveTable}
                  className="p-2 bg-gray-800/90 text-white rounded-full hover:bg-gray-700 transition shadow-lg"
                  style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}
                >
                  <IoExitOutline className="h-5 w-5" />
                </button>
                <div className="relative" ref={infoRef}>
                  <button
                    onClick={() => setShowGameInfo((v) => !v)}
                    className="p-2 bg-gray-800/90 text-white rounded-full hover:bg-gray-700 transition shadow-lg"
                    style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}
                  >
                    <IoInformationCircleOutline className="h-5 w-5" />
                  </button>
                  {showGameInfo && (
                    <div className="absolute left-0 mt-2 w-64 bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl p-4 z-50 text-sm text-white">
                      <div className="font-bold mb-2 flex items-center gap-2">
                        <IoInformationCircleOutline className="inline-block h-4 w-4 text-blue-400" />
                        Table Details
                      </div>
                      {/* GameTile-style info header */}
                      <div className="flex items-center gap-2 text-sm mb-2">
                        {/* Game type brick */}
                        {(() => {
                          const type = gameState.rules?.gameType || 'REGULAR';
                          let color = 'bg-green-600';
                          let label = 'REGULAR';
                          if (type === 'WHIZ') {
                            color = 'bg-blue-600';
                            label = 'WHIZ';
                          } else if (type === 'MIRROR') {
                            color = 'bg-red-600';
                            label = 'MIRRORS';
                          } else if (gameState.forcedBid && type === 'REGULAR') {
                            color = 'bg-orange-500';
                            if (gameState.forcedBid === 'BID4NIL') label = 'BID 4 OR NIL';
                            else if (gameState.forcedBid === 'BID3') label = 'BID 3';
                            else if (gameState.forcedBid === 'BIDHEARTS') label = 'BID HEARTS';
                            else if (gameState.forcedBid === 'SUICIDE') label = 'SUICIDE';
                            else label = 'GIMMICK';
                          }
                          return <span className={`inline-block ${color} text-white font-bold text-xs px-2 py-0.5 rounded mr-2`}>{label}</span>;
                        })()}
                        {/* Points */}
                        <span className="text-slate-300 font-medium">{gameState.minPoints}/{gameState.maxPoints}</span>
                        {/* Nil and bn (blind nil) with inline check/cross */}
                        {gameState.rules?.allowNil && <span className="text-slate-300 ml-2">nil <span className="align-middle">☑️</span></span>}
                        {!gameState.rules?.allowNil && <span className="text-slate-300 ml-2">nil <span className="align-middle">❌</span></span>}
                        <span className="text-slate-300 ml-2">bn <span className="align-middle">{gameState.rules?.allowBlindNil ? '☑️' : '❌'}</span></span>
                      </div>
                      {/* Line 2: Buy-in, game mode, and special bricks */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-yellow-500 text-lg font-bold">{((gameState.buyIn ?? gameState.rules?.coinAmount ?? 100000) / 1000).toFixed(0)}k</span>
                        <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="ml-2 text-xs font-bold text-slate-200 uppercase">{gameState.gameMode || (gameState.rules?.gameType === 'SOLO' ? 'SOLO' : 'PARTNERS')}</span>
                        {/* Special bricks for assassin/screamer */}
                        {gameState.specialRules?.assassin && (
                          <span className="inline-block bg-red-600 text-white font-bold text-xs px-2 py-0.5 rounded ml-2">ASSASSIN</span>
                        )}
                        {gameState.specialRules?.screamer && (
                          <span className="inline-block bg-blue-600 text-white font-bold text-xs px-2 py-0.5 rounded ml-2">SCREAMER</span>
                        )}
                      </div>
                      {/* Prize info (unchanged) */}
                      <div className="mt-2 pt-2 border-t border-gray-700">
                        <div className="text-sm">
                          <span className="text-gray-400">Prize:</span>
                          <span className="font-bold text-yellow-400 ml-2">
                            {(() => {
                              const buyIn = gameState.rules?.coinAmount || 100000;
                              const prizePot = buyIn * 4 * 0.9;
                              if ((gameState.rules?.gameType || '').toUpperCase() === 'PARTNERS') {
                                return `${formatCoins(prizePot / 2)} each`;
                              } else {
                                return `1st: ${formatCoins(prizePot * 0.7)}, 2nd: ${formatCoins(prizePot * 0.3)}`;
                              }
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Scoreboard in top right corner - inside the table */}
              <div className="absolute top-4 right-4 z-10 flex flex-col items-center gap-2 px-3 py-2 bg-gray-800/90 rounded-lg shadow-lg">
                {/* Team 1 (Red) Score and Bags */}
                <div className="flex items-center">
                  <div className="bg-red-500 rounded-full w-2 h-2 mr-1"></div>
                  <span className="text-white font-bold mr-1 text-sm">{team1Score}</span>
                  {/* Team 1 Bags */}
                  <div className="flex items-center text-yellow-300 ml-2" title={`Team 1 Bags: ${team1Bags}`}> 
                    <img src="/bag.svg" width={16} height={16} alt="Bags" className="mr-1" />
                    <span className="text-xs font-bold">{team1Bags}</span>
                  </div>
                </div>

                {/* Team 2 (Blue) Score and Bags */}
                <div className="flex items-center">
                  <div className="bg-blue-500 rounded-full w-2 h-2 mr-1"></div>
                  <span className="text-white font-bold mr-1 text-sm">{team2Score}</span>
                  {/* Team 2 Bags */}
                  <div className="flex items-center text-yellow-300 ml-2" title={`Team 2 Bags: ${team2Bags}`}> 
                    <img src="/bag.svg" width={16} height={16} alt="Bags" className="mr-1" />
                    <span className="text-xs font-bold">{team2Bags}</span>
                  </div>
                </div>
              </div>
        
              {/* Players around the table */}
              {[0, 1, 2, 3].map((position) => (
                <div key={`player-position-${position}`}>
                  {renderPlayerPosition(position)}
                </div>
              ))}

              {/* Center content */}
              {renderTrickCards()}

              {/* Overlay the game status buttons/messages on top of the play area */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {gameState.status === "WAITING" && sanitizedPlayers.length === 4 && sanitizedPlayers[0]?.id === currentPlayerId ? (
                  <button
                    onClick={handleStartGame}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-bold rounded-lg shadow-lg transform hover:scale-105 transition-all pointer-events-auto"
                    style={{ fontSize: `${Math.floor(16 * scaleFactor)}px` }}
                  >
                    Start Game
                  </button>
                ) : gameState.status === "WAITING" && sanitizedPlayers.length < 4 ? (
                  <div className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-center pointer-events-auto"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    <div className="font-bold">Waiting for Players</div>
                    <div className="text-sm mt-1">{sanitizedPlayers.length}/4 joined</div>
                  </div>
                ) : gameState.status === "WAITING" && sanitizedPlayers[0]?.id !== currentPlayerId ? (
                  <div className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-center pointer-events-auto"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    <div className="font-bold">Waiting for Host</div>
                    <div className="text-sm mt-1">Only {isPlayer(sanitizedPlayers[0]) ? sanitizedPlayers[0].name : isBot(sanitizedPlayers[0]) ? sanitizedPlayers[0].username : 'Unknown'} can start</div>
                  </div>
                ) : gameState.status === "BIDDING" && gameState.currentPlayer === currentPlayerId ? (
                  <div className="flex items-center justify-center w-full h-full pointer-events-auto">
                    <BiddingInterface
                      onBid={handleBid}
                      currentBid={orderedPlayers[0]?.bid}
                      gameType={gameState.rules.gameType}
                      numSpades={currentPlayer ? countSpades(currentPlayer.hand) : 0}
                      playerId={currentPlayerId}
                      currentPlayerTurn={gameState.currentPlayer}
                      allowNil={gameState.rules.allowNil}
                    />
                  </div>
                ) : gameState.status === "BIDDING" && gameState.currentPlayer !== currentPlayerId ? (
                  <div className="px-4 py-2 bg-gray-700 text-white rounded-lg text-center animate-pulse pointer-events-auto"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    {(() => {
                      const waitingPlayer = sanitizedPlayers.find((p): p is Player | Bot => !!p && p.id === gameState.currentPlayer) || null;
                      const waitingName = isPlayer(waitingPlayer) ? waitingPlayer.name : isBot(waitingPlayer) ? waitingPlayer.username : "Unknown";
                      return (
                        <div className="font-bold">Waiting for {waitingName}</div>
                      );
                    })()}
                  </div>
                ) : gameState.status === "PLAYING" && currentTrick?.length === 0 ? (
                  <div className="px-4 py-2 bg-gray-700/70 text-white rounded-lg text-center pointer-events-auto"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    {(() => {
                      const waitingPlayer = sanitizedPlayers.find((p): p is Player | Bot => !!p && p.id === gameState.currentPlayer) || null;
                      const waitingName = isPlayer(waitingPlayer) ? waitingPlayer.name : isBot(waitingPlayer) ? waitingPlayer.username : "Unknown";
                      return (
                        <div className="text-sm">Waiting for {waitingName} to play</div>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Cards area with more space */}
            <div className="bg-gray-800/50 rounded-lg relative mb-0" 
                 style={{ 
                   height: `${Math.floor(110 * scaleFactor)}px`
                 }}>
              {renderPlayerHand()}
            </div>
          </div>

          {/* Chat area - 30%, full height */}
          <div className="w-[30%] h-full overflow-hidden">
            {chatReady ? (
              <Chat 
                gameId={gameState.id}
                userId={currentPlayerId || ''}
                userName={isPlayer(currentPlayer) ? currentPlayer.name : isBot(currentPlayer) ? currentPlayer.username : 'Unknown'}
                players={sanitizedPlayers.filter((p): p is Player => isPlayer(p))}
                userAvatar={isPlayer(currentPlayer) ? currentPlayer.avatar : undefined}
                chatType={chatType}
                onToggleChatType={() => setChatType(chatType === 'game' ? 'lobby' : 'game')}
                lobbyMessages={lobbyMessages}
                spectators={(gameState as any).spectators || []}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-lg">Connecting chat...</div>
            )}
          </div>
        </div>

        {/* Hand Summary Modal - Pass currentHandSummary */}
        {showHandSummary && (
          <HandSummaryModal
            isOpen={showHandSummary}
            onClose={() => setShowHandSummary(false)}
            gameState={gameState}
            onNextHand={() => {
              setShowHandSummary(false);
              // Add any next hand logic here
            }}
            onNewGame={() => {
              setShowHandSummary(false);
              // Add any new game logic here
            }}
          />
        )}

        {/* Winner Modal */}
        {showWinner && (
          <WinnerModal
            isOpen={true}
            onClose={handleLeaveTable}
            team1Score={gameState.scores.team1}
            team2Score={gameState.scores.team2}
            winningTeam={1}
            onPlayAgain={handlePlayAgain}
          />
        )}

        {/* Loser Modal */}
        {showLoser && (
          <LoserModal
            isOpen={true}
            onClose={handleLeaveTable}
            team1Score={gameState.scores.team1}
            team2Score={gameState.scores.team2}
            winningTeam={2}
            onPlayAgain={handlePlayAgain}
          />
        )}
      </div>
    </>
  );
}