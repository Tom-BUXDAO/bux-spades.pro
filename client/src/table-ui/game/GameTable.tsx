"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { GameState, Card, Suit, Player, TeamScore, HandSummary, CompletedTrick } from "../types/game";
import { Socket } from "socket.io-client";
import Chat from './Chat';
import HandSummaryModal from './HandSummaryModal';
import WinnerModal from './WinnerModal';
import LoserModal from './LoserModal';
import BiddingInterface from './BiddingInterface';
import { calculateHandScore } from '../../lib/scoring';
import LandscapePrompt from '../../LandscapePrompt';
import { IoExitOutline, IoInformationCircleOutline } from "react-icons/io5";
import { useWindowSize } from '../../hooks/useWindowSize';
import { socketApi } from '../../lib/socketApi';

interface GameTableProps {
  game: GameState;
  socket: Socket | null;
  createGame: (user: { id: string; name?: string | null }) => void;
  joinGame: (gameId: string, userId: string, options?: any) => void;
  onGamesUpdate: React.Dispatch<React.SetStateAction<GameState[]>>;
  onLeaveTable: () => void;
  startGame: (gameId: string, userId?: string) => Promise<void>;
  user?: any;
}

// Fallback avatars 
const GUEST_AVATAR = "/guest-avatar.png";
const BOT_AVATAR = "/guest-avatar.png";

// Helper function to get card image filename
function getCardImage(card: Card): string {
  if (!card) return 'back.png';
  const rankMap: Record<number, string> = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A'
  };
  return `${rankMap[card.rank]}${card.suit}.png`;
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

// Helper function to get suit order
function getSuitOrder(suit: string): number {
  const suitOrder: { [key: string]: number } = {
    '♣': 1, // Clubs first
    '♥': 2, // Hearts second
    '♦': 3, // Diamonds third
    '♠': 4  // Spades last
  };
  return suitOrder[suit];
}

// Helper function to sort cards
function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const suitOrder: Record<Suit, number> = { 'D': 0, 'C': 1, 'H': 2, 'S': 3 };
    if (a.suit !== b.suit) {
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    return a.rank - b.rank;
  });
}

// Add new helper functions after the existing ones
function getLeadSuit(trick: Card[]): Suit | null {
  return trick[0]?.suit || null;
}

function hasSpadeBeenPlayed(game: GameState): boolean {
  // Check if any completed trick contained a spade
  return game.completedTricks?.some((trick: any) =>
    Array.isArray(trick.cards) && trick.cards.some((card: Card) => card.suit === 'S')
  ) || false;
}

function canLeadSpades(game: GameState, hand: Card[]): boolean {
  // Can lead spades if:
  // 1. Spades have been broken, or
  // 2. Player only has spades left
  return hasSpadeBeenPlayed(game) || hand.every(card => card.suit === 'S');
}

function getPlayableCards(game: GameState, hand: Card[], isLeadingTrick: boolean): Card[] {
  if (!hand.length) return [];

  // If leading the trick
  if (isLeadingTrick) {
    // If spades haven't been broken, filter out spades unless only spades remain
    if (!canLeadSpades(game, hand)) {
      const nonSpades = hand.filter(card => card.suit !== 'S');
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

function determineWinningCard(trick: Card[]): number {
  if (!trick.length) return -1;

  const leadSuit = trick[0].suit;
  
  console.log("DETERMINING WINNING CARD:", trick.map(c => `${c.rank}${c.suit}`));
  
  // Check if any spades were played - spades always trump other suits
  const spadesPlayed = trick.filter(card => card.suit === 'S');
  
  if (spadesPlayed.length > 0) {
    // Find the highest spade
    const highestSpade = spadesPlayed.reduce((highest, current) => {
      const currentValue = getCardValue(current.rank);
      const highestValue = getCardValue(highest.rank);
      console.log(`Comparing spades: ${current.rank}${current.suit} (${currentValue}) vs ${highest.rank}${highest.suit} (${highestValue})`);
      return currentValue > highestValue ? current : highest;
    }, spadesPlayed[0]);
    
    console.log(`Highest spade is ${highestSpade.rank}${highestSpade.suit}`);
    
    // Return the index of the highest spade
    for (let i = 0; i < trick.length; i++) {
      if (trick[i].suit === 'S' && trick[i].rank === highestSpade.rank) {
        console.log(`Winning card is at position ${i}: ${trick[i].rank}${trick[i].suit}`);
        return i;
      }
    }
  }
  
  // If no spades, find the highest card of the lead suit
  const leadSuitCards = trick.filter(card => card.suit === leadSuit);
  
  console.log(`Lead suit is ${leadSuit}, cards of this suit:`, leadSuitCards.map(c => `${c.rank}${c.suit}`));
  
  // Debug each card's numeric value
  leadSuitCards.forEach(card => {
    console.log(`Card ${card.rank}${card.suit} has numeric value: ${getCardValue(card.rank)}`);
  });
  
  const highestLeadSuitCard = leadSuitCards.reduce((highest, current) => {
    const currentValue = getCardValue(current.rank);
    const highestValue = getCardValue(highest.rank);
    console.log(`Comparing: ${current.rank}${current.suit} (${currentValue}) vs ${highest.rank}${highest.suit} (${highestValue})`);
    return currentValue > highestValue ? current : highest;
  }, leadSuitCards[0]);
  
  console.log(`Highest card of lead suit ${leadSuit} is ${highestLeadSuitCard.rank}${highestLeadSuitCard.suit}`);
  
  // Return the index of the highest lead suit card
  for (let i = 0; i < trick.length; i++) {
    if (trick[i].suit === leadSuit && trick[i].rank === highestLeadSuitCard.rank) {
      console.log(`Winning card is at position ${i}: ${trick[i].rank}${trick[i].suit}`);
      return i;
    }
  }
  
  // Fallback (should never happen)
  console.error("Failed to determine winning card - this should never happen", trick);
  return 0;
}

// Add a new interface to track which player played each card
interface TrickCard extends Card {
  // No need to redefine playedBy since we want to use the same type as Card
}

// Add this near the top of the file, after imports
declare global {
  interface Window {
    lastCompletedTrick: {
      cards: Card[];
      winnerIndex: number;
      timeout: any;
    } | null;
  }
}

// Helper function to count spades in a hand
const countSpades = (hand: Card[]): number => {
  return hand.filter(card => card.suit === 'S').length;
};

interface ChatMessage {
  message: string;
  playerId: string;
  timestamp: number;
}

export default function GameTable({ 
  game, 
  socket, 
  createGame, 
  joinGame, 
  onGamesUpdate,
  onLeaveTable,
  startGame,
  user: propUser
}: GameTableProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const tableRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedBid, setSelectedBid] = useState<number | null>(null);
  const [showHandSummary, setShowHandSummary] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const [showLoser, setShowLoser] = useState(false);
  const [currentHandSummary, setCurrentHandSummary] = useState<HandSummary | null>(null);
  
  // Use the windowSize hook to get responsive information
  const windowSize = useWindowSize();
  
  // Game configuration constants
  const WINNING_SCORE = 500; // Score needed to win the game
  const MODAL_DISPLAY_TIME = 5000; // Time to show modals in milliseconds
  
  // Add state to directly track which player played which card
  const [cardPlayers, setCardPlayers] = useState<{[key: string]: string}>({});
  
  // Add a ref to preserve completed trick card-player mappings
  const completedTrickCardPlayers = useRef<Record<number, string>>({});
  
  // Add state for tracking the winning card
  const [winningCardIndex, setWinningCardIndex] = useState<number | null>(null); 
  const [winningPlayerId, setWinningPlayerId] = useState<string | null>(null);
  const [showWinningCardHighlight, setShowWinningCardHighlight] = useState(false);
  
  const user = propUser;
  
  // Initialize currentTrick if it doesn't exist
  const currentTrick = game.currentTrick || [];
  
  // Add state to store player positions for the current trick
  const [trickCardPositions, setTrickCardPositions] = useState<Record<number, number>>({});

  // Find the current player's ID
  const currentPlayerId = user?.id;
  
  // After getting the players array:
  const sanitizedPlayers = (game.players || []).filter(Boolean);
  const isObserver = !sanitizedPlayers.some((p: Player) => p.id === currentPlayerId);
  console.log('game.players:', game.players); // Debug log to catch nulls
  sanitizedPlayers.forEach((p: Player, i: number) => {
    if (!p) throw new Error('Null or undefined player at index ' + i + ' in sanitizedPlayers!');
  });
  // Use sanitizedPlayers everywhere instead of game.players
  // Example:
  // const currentPlayer = sanitizedPlayers.find(p => p.id === currentPlayerId) || null;
  // ... and so on for all .find, .map, .filter, etc. on players

  // Find the current player's position and team
  const currentPlayer = sanitizedPlayers.find((p: Player) => p.id === currentPlayerId) || null;
  const currentTeam = currentPlayer?.team;

  // Add state to force component updates when the current player changes
  const [lastCurrentPlayer, setLastCurrentPlayer] = useState<string>(game.currentPlayer);
  
  // Track all game state changes that would affect the UI
  useEffect(() => {
    if (lastCurrentPlayer !== game.currentPlayer) {
      console.log(`Current player changed: ${lastCurrentPlayer} -> ${game.currentPlayer} (my ID: ${currentPlayerId})`);
      setLastCurrentPlayer(game.currentPlayer);
      
      // Force a component state update to trigger re-renders of children
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('gameStateChanged'));
      }
    }
  }, [game.currentPlayer, lastCurrentPlayer, currentPlayerId]);

  // Use the explicit position property if available, otherwise fall back to array index
  // @ts-ignore - position property might not be on the type yet
  const currentPlayerPosition = currentPlayer?.position !== undefined ? currentPlayer.position : sanitizedPlayers.findIndex(p => p.id === currentPlayerId);

  // FIXED ROTATION: Always put current player at bottom (South)
  const rotatePlayersForCurrentView = () => {
    // Find the current player's position
    const currentPlayerPosition = currentPlayer?.position ?? 0;
    
    // Create a rotated array where current player is at position 0 (South)
    const rotatedPlayers = sanitizedPlayers.map((player: Player | null) => {
      if (!player) return null;
      // Calculate new position: (4 + originalPos - currentPlayerPosition) % 4
      // This ensures current player is at 0, and others are rotated accordingly
      const newPosition = (4 + (player.position ?? 0) - currentPlayerPosition) % 4;
      return { ...player, displayPosition: newPosition } as Player & { displayPosition: number };
    });
    
    // Create final array with players in their display positions
    const positions = Array(4).fill(null);
    rotatedPlayers.forEach((player: (Player & { displayPosition: number }) | null) => {
      if (player && player.displayPosition !== undefined) {
        positions[player.displayPosition] = player;
      }
    });
    
    return positions;
  };

  // Preserve original positions in the array so the server knows where everyone sits
  const orderedPlayers = rotatePlayersForCurrentView();

  // Determine player team color based on their ACTUAL team, not position
  const getTeamColor = (player: typeof orderedPlayers[number]): 1 | 2 => {
    if (!player) return 1;
    return player.team || 1;
  };

  const isCurrentPlayersTurn = game.currentPlayer === currentPlayerId;

  const handleBid = (bid: number) => {
    if (!currentPlayerId || !currentPlayer) {
      console.error('Cannot bid: No current player or player ID');
      return;
    }
    
    // Validate that it's actually this player's turn
    if (game.currentPlayer !== currentPlayerId) {
      console.error(`Cannot bid: Not your turn. Current player is ${game.currentPlayer}`);
      return;
    }
    
    // Validate game state
    if (game.status !== 'BIDDING') {
      console.error(`Cannot bid: Game is not in bidding state (${game.status})`);
      return;
    }
    
    console.log(`Submitting bid: ${bid} for player ${currentPlayerId} in game ${game.id}`);
    socket?.emit("make_bid", { gameId: game.id, userId: currentPlayerId, bid });
    console.log('Game status:', game.status, 'Current player:', game.currentPlayer);
    console.log('Socket connected:', socket?.connected);
  };

  // Fix the getLeadPosition function
  const getLeadPosition = () => {
    // If it's the first trick, the player after the dealer leads
    if ((!game as any).tricks?.length === undefined && !game?.currentTrick?.length) {
      const dealer = sanitizedPlayers.find((p: Player) => p.isDealer);
      return ((dealer?.position ?? 0) + 1) % 4;
    }
    // If it's a new trick (but not the first), use the last trick's winner
    if (!game?.currentTrick?.length && (game as any).tricks?.length) {
      const lastTrick = (game as any).tricks[(game as any).tricks.length - 1];
      const winner = sanitizedPlayers.find((p: Player) => p.id === lastTrick?.winningPlayerId);
      return winner?.position ?? 0;
    }
    // If we're in the middle of a trick, use the first player of the trick
    const firstPlayer = sanitizedPlayers.find((p: Player) => p.id === cardPlayers?.['0']);
    return firstPlayer?.position ?? 0;
  };

  // Effect to track which card was played by which player
  useEffect(() => {
    // Only run this effect if the game is actually playing
    if (game.status !== "PLAYING") return;

    // When a new trick starts, reset our tracking
    if (currentTrick.length === 0) {
      console.log("🔄 New trick starting - resetting card players mapping");
      setCardPlayers({});
      setShowWinningCardHighlight(false);
      setWinningCardIndex(null);
      setWinningPlayerId(null);
      return;
    }

    // Map each card to its player
    currentTrick.forEach((card: Card, index: number) => {
      if (!card.playedBy) {
        console.error(`Card at index ${index} has no playedBy information:`, card);
        return;
      }

      // Calculate relative position from current player's view
      const relativePosition = (4 + card.playedBy.position - currentPlayerPosition) % 4;
      
      console.log(`Card ${index} (${card.rank}${card.suit}): played by ${card.playedBy.name} at position ${card.playedBy.position}, relative pos ${relativePosition}`);
      
      // Update our card players mapping
      const updatedMapping = { ...cardPlayers };
      updatedMapping[index.toString()] = card.playedBy.id;
      setCardPlayers(updatedMapping);
    });
  }, [game.status, currentTrick, sanitizedPlayers, currentPlayerPosition, game.completedTricks]);

  // When playing a card, we now rely solely on server data for tracking
  const handlePlayCard = (card: Card) => {
    if (!socket || !currentPlayerId || !currentPlayer) return;

    // Validate if it's player's turn
    if (game.currentPlayer !== currentPlayerId) {
      console.error(`Cannot play card: Not your turn`);
      return;
    }

    // Check if card is playable
    const isLeadingTrick = currentTrick.length === 0;
    const playableCards = currentPlayer ? getPlayableCards(game, currentPlayer.hand, isLeadingTrick) : [];
    if (!playableCards.some((c: Card) => c.suit === card.suit && c.rank === card.rank)) {
      console.error('This card is not playable in the current context');
      return;
    }

    console.log(`Playing card: ${card.rank}${card.suit} as player ${currentPlayer?.name ?? 'Unknown'}`);
    
    // Update our local tracking immediately to know that current player played this card
    // This helps prevent the "Unknown" player issue when we play our own card
    const updatedMapping = { ...cardPlayers };
    updatedMapping[currentTrick.length.toString()] = currentPlayerId;
    setCardPlayers(updatedMapping);
    
    // Send the play to the server
    socket.emit("play_card", { 
      gameId: game.id, 
      userId: currentPlayerId, 
      card 
    });
  };

  // Inside the GameTable component, add these state variables
  const [delayedTrick, setDelayedTrick] = useState<Card[] | null>(null);
  const [delayedWinningIndex, setDelayedWinningIndex] = useState<number | null>(null);
  const [isShowingTrickResult, setIsShowingTrickResult] = useState(false);

  // Add this useEffect to handle trick completion
  useEffect(() => {
    if (!socket) return;
    
    console.log("Setting up trick completion delay handler");
    
    // Set up the trick completion delay handler
    const cleanup = socketApi.setupTrickCompletionDelay(socket, game.id, ({ trickCards, winningIndex }) => {
      console.log("Trick completion callback fired:", trickCards, winningIndex);
      
      // Save the trick data
      setDelayedTrick(trickCards);
      setDelayedWinningIndex(winningIndex);
      setIsShowingTrickResult(true);
      
      // After delay, clear the trick
      setTimeout(() => {
        setIsShowingTrickResult(false);
        setDelayedTrick(null);
        setDelayedWinningIndex(null);
      }, 3000);
    });
    
    return cleanup;
  }, [socket, game.id]);

  // Add this function at the bottom of the component
  const getPlayerWhoPlayedCard = (cardIndex: number) => {
    // Get player ID from our tracking
    const playerId = cardPlayers[cardIndex.toString()];
    if (!playerId) return null;
    
    // Find the player object
    return sanitizedPlayers.find((p: Player) => p.id === playerId) || null;
  };
  
  // Add state for trick completion animation
  const [completedTrick, setCompletedTrick] = useState<CompletedTrick | null>(null);
  const [showTrickAnimation, setShowTrickAnimation] = useState(false);

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

  // Add CSS classes for card animations
  const cardAnimationClass = (card: Card) => {
    if (!showTrickAnimation || !completedTrick) return '';
    
    return card === completedTrick.winningCard
      ? 'opacity-100 scale-110 border-2 border-yellow-400 z-10'
      : 'opacity-40 scale-95';
  };

  const handleLeaveTable = () => {
    if (currentPlayerId && socket) {
      socket.emit("leave_game", { gameId: game.id, userId: currentPlayerId });
    }
    setShowWinner(false);
    setShowLoser(false);
    setShowHandSummary(false);
    setCurrentHandSummary(null);
    onLeaveTable();
  };

  const handleStartGame = async () => {
    if (!currentPlayerId) return;
    
    // Make sure the game is in the WAITING state
    if (game.status !== "WAITING") {
      console.error(`Cannot start game: game is in ${game.status} state, not WAITING`);
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
      console.log(`Starting game ${game.id} as user ${currentPlayerId}, creator: ${sanitizedPlayers[0]?.id}`);
      await startGame(game.id, currentPlayerId);
    } catch (error) {
      console.error("Failed to start game:", error);
    }
  };

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
  
  // Scale dimensions for card images - use fixed size on mobile
  const cardWidth = windowSize.width < 640 ? 25 : Math.floor(96 * scaleFactor);
  const cardHeight = windowSize.width < 640 ? 38 : Math.floor(144 * scaleFactor);
  const avatarSize = Math.floor(64 * scaleFactor);
  
  // Player positions mapping - responsive
  const playerPositions = useMemo(() => {
    return isMobile ? {
      bottom: "bottom-0 left-1/2 transform -translate-x-1/2",
      left: "left-0 top-1/3 transform -translate-y-1/2",
      top: "top-0 left-1/2 transform -translate-x-1/2",
      right: "right-0 top-1/3 transform -translate-y-1/2",
    } : {
      bottom: "bottom-3 left-1/2 transform -translate-x-1/2",
      left: "left-3 top-1/2 transform -translate-y-1/2",
      top: "top-3 left-1/2 transform -translate-x-1/2",
      right: "right-3 top-1/2 transform -translate-y-1/2",
    };
  }, [isMobile]);
  
  // Update the player tricks display
  const renderPlayerPosition = (position: number) => {
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

    const player = orderedPlayers[position];
    // If observer and seat is empty, show join button
    if (isObserver && !player) {
      return (
        <div className={`absolute ${getPositionClasses(position)} z-10`}>
          <button
            className="w-16 h-16 rounded-full bg-slate-600 border border-slate-300 text-slate-200 text-base flex items-center justify-center hover:bg-slate-500 transition"
            onClick={() => joinGame(game.id, user.id, { seat: position, username: user.username, avatar: user.avatar })}
          >
            JOIN
          </button>
        </div>
      );
    }
    if (!player) return null;

    const isActive = game.status !== "WAITING" && game.currentPlayer === player.id;
    const isWinningTrick = showTrickAnimation && completedTrick?.winningCard.suit === player.hand[0].suit && completedTrick?.winningCard.rank === player.hand[0].rank;
    
    // Determine if we're on mobile
    // const isMobile = screenSize.width < 640;
    // Use the isMobile state which is derived from windowSize
    
    // Get player avatar
    const getPlayerAvatar = (player: Player | null) => {
      if (!player) return '/guest-avatar.png';
      return player.image ?? '/guest-avatar.png';
    };

    // Determine if this is a left/right seat (position 1 or 3)
    const isSideSeat = position === 1 || position === 3;
    
    // Calculate sizes based on device
    const avatarWidth = isMobile ? 32 : 40;
    const avatarHeight = isMobile ? 32 : 40;
    
    // Determine made/bid status color
    const madeCount = player.tricks || 0;
    const bidCount = player.bid !== undefined ? player.bid : 0;
    // Replace color-based status with emoji indicators
    const madeStatus = madeCount >= bidCount 
      ? "✅" // Checkmark for met or exceeded bid
      : "❌"; // X for not met bid
    
    // Custom team colors
    const redTeamGradient = "bg-gradient-to-r from-red-700 to-red-500";
    const blueTeamGradient = "bg-gradient-to-r from-blue-700 to-blue-500";
    const teamGradient = player.team === 1 ? redTeamGradient : blueTeamGradient;
    const teamLightColor = player.team === 1 ? 'bg-red-400' : 'bg-blue-400';
    const teamAccentColor = player.team === 1 ? 'from-red-400' : 'from-blue-400';
    const teamTextColor = player.team === 1 ? 'text-red-600' : 'text-blue-600';

    return (
      <div className={`absolute ${getPositionClasses(position)} ${isActive ? 'z-10' : 'z-0'}`}>
        <div className={`
          backdrop-blur-sm bg-white/10 rounded-xl overflow-hidden
          ${isActive ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/30' : 'shadow-md'}
          ${isWinningTrick ? 'animate-pulse' : ''}
          transition-all duration-200
        `}>
          {isSideSeat ? (
            // Left/right seats - vertical layout
            <div className="flex flex-col items-center p-1.5 gap-1.5">
              {/* Avatar with glowing active border */}
              <div className={`relative`}>
                <div className={`
                  rounded-full overflow-hidden p-0.5
                  ${isActive ? 'bg-gradient-to-r from-yellow-300 to-yellow-500 animate-pulse' : 
                    `bg-gradient-to-r ${teamAccentColor} to-white/80`}
                `}>
                  <div className="bg-gray-900 rounded-full p-0.5">
                    <img
                      src={getPlayerAvatar(player)}
                      alt={player.username || "Player"}
                      width={avatarWidth}
                      height={avatarHeight}
                      className="rounded-full object-cover"
                    />
                  </div>
                  
                  {/* Dealer chip with premium styling */}
                  {player.isDealer && (
                    <div className="absolute -bottom-1 -right-1">
                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-r from-yellow-300 to-yellow-500 shadow-md">
                        <div className="w-4 h-4 rounded-full bg-yellow-600 flex items-center justify-center">
                          <span className="text-[8px] font-bold text-yellow-200">D</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex flex-col items-center gap-1">
                {/* Player name with team color gradient background */}
                <div className={`w-full px-2 py-1 rounded-lg shadow-sm ${teamGradient}`} style={{ width: isMobile ? '50px' : '70px' }}>
                  <div className="text-white font-medium truncate text-center"
                       style={{ fontSize: isMobile ? '9px' : '11px' }}>
                    {player.username}
                  </div>
                </div>
                
                {/* Bid/Trick counter with glass morphism effect */}
                <div className="backdrop-blur-md bg-white/20 rounded-full px-2 py-0.5 shadow-inner flex items-center justify-center gap-1"
                     style={{ width: isMobile ? '50px' : '70px' }}>
                  <span style={{ fontSize: isMobile ? '9px' : '11px', fontWeight: 600 }}>
                    {game.status === "WAITING" ? "0" : madeCount}
                  </span>
                  <span className="text-white/70" style={{ fontSize: isMobile ? '9px' : '11px' }}>/</span>
                  <span className="text-white font-semibold" style={{ fontSize: isMobile ? '9px' : '11px' }}>
                    {game.status === "WAITING" ? "0" : bidCount}
                  </span>
                  <span style={{ fontSize: isMobile ? '10px' : '12px' }} className="ml-1">
                    {game.status === "WAITING" ? "" : madeStatus}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            // Top/bottom seats - horizontal layout
            <div className="flex items-center p-1.5 gap-1.5">
              {/* Avatar with glowing active border */}
              <div className={`relative`}>
                <div className={`
                  rounded-full overflow-hidden p-0.5
                  ${isActive ? 'bg-gradient-to-r from-yellow-300 to-yellow-500 animate-pulse' : 
                    `bg-gradient-to-r ${teamAccentColor} to-white/80`}
                `}>
                  <div className="bg-gray-900 rounded-full p-0.5">
                    <img
                      src={getPlayerAvatar(player)}
                      alt={player.username || "Player"}
                      width={avatarWidth}
                      height={avatarHeight}
                      className="rounded-full object-cover"
                    />
                  </div>
                  
                  {/* Dealer chip with premium styling */}
                  {player.isDealer && (
                    <div className="absolute -bottom-1 -right-1">
                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-r from-yellow-300 to-yellow-500 shadow-md">
                        <div className="w-4 h-4 rounded-full bg-yellow-600 flex items-center justify-center">
                          <span className="text-[8px] font-bold text-yellow-200">D</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex flex-col gap-1 items-center">
                {/* Player name with team color gradient background */}
                <div className={`w-full px-2 py-1 rounded-lg shadow-sm ${teamGradient}`} style={{ width: isMobile ? '50px' : '70px' }}>
                  <div className="text-white font-medium truncate text-center"
                       style={{ fontSize: isMobile ? '9px' : '11px' }}>
                    {player.username}
                  </div>
                </div>
                
                {/* Bid/Trick counter with glass morphism effect */}
                <div className="backdrop-blur-md bg-white/20 rounded-full px-2 py-0.5 shadow-inner flex items-center justify-center gap-1"
                     style={{ width: isMobile ? '50px' : '70px' }}>
                  <span style={{ fontSize: isMobile ? '9px' : '11px', fontWeight: 600 }}>
                    {game.status === "WAITING" ? "0" : madeCount}
                  </span>
                  <span className="text-white/70" style={{ fontSize: isMobile ? '9px' : '11px' }}>/</span>
                  <span className="text-white font-semibold" style={{ fontSize: isMobile ? '9px' : '11px' }}>
                    {game.status === "WAITING" ? "0" : bidCount}
                  </span>
                  <span style={{ fontSize: isMobile ? '10px' : '12px' }} className="ml-1">
                    {game.status === "WAITING" ? "" : madeStatus}
                  </span>
                </div>
              </div>
              
              {/* Winning animation with improved animation */}
              {isWinningTrick && (
                <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2">
                  <div className={`
                    ${player.team === 1 ? 'text-red-400' : 'text-blue-400'} 
                    font-bold animate-bounce flex items-center gap-0.5
                  `} style={{ fontSize: isMobile ? '10px' : '12px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" 
                         className="w-3 h-3 inline-block">
                      <path fillRule="evenodd" d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.061l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.931l-3.042-.815a.75.75 0 01-.53-.919z" clipRule="evenodd" />
                    </svg>
                    <span>+1</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderPlayerHand = () => {
    if (!currentPlayer) return null;
    const sortedHand = currentPlayer.hand ? sortCards(currentPlayer.hand) : [];
    
    // Determine playable cards
    const isLeadingTrick = currentTrick.length === 0;
    const playableCards = game.status === "PLAYING" && currentPlayer ? getPlayableCards(game, currentPlayer.hand || [], isLeadingTrick) : [];
    
    // Calculate card width based on screen size
    const isMobile = windowSize.isMobile;
    const cardUIWidth = Math.floor(isMobile ? 70 : 84 * scaleFactor);
    const cardUIHeight = Math.floor(isMobile ? 100 : 120 * scaleFactor);
    const overlapOffset = Math.floor(isMobile ? -40 : -32 * scaleFactor); // How much cards overlap

    return (
      <div className="absolute inset-x-0 bottom-0 flex justify-center">
        <div className="flex">
        {sortedHand.map((card: Card, index: number) => {
          const isPlayable = game.status === "PLAYING" && 
            game.currentPlayer === currentPlayerId &&
            playableCards.some((c: Card) => c.suit === card.suit && c.rank === card.rank);

          return (
            <div
              key={`${card.suit}${card.rank}`}
                className={`relative transition-transform hover:-translate-y-4 hover:z-10 ${
                isPlayable ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
              style={{ 
                width: `${cardUIWidth}px`, 
                height: `${cardUIHeight}px`,
                  marginLeft: index > 0 ? `${overlapOffset}px` : '0',
                  zIndex: index
              }}
              onClick={() => isPlayable && handlePlayCard(card)}
            >
              <div className="relative">
                <img
                  src={`/cards/${getCardImage(card)}`}
                  alt={`${card.rank}${card.suit}`}
                  width={cardUIWidth}
                  height={cardUIHeight}
                  className={`rounded-lg shadow-md ${
                    isPlayable ? 'hover:shadow-lg' : ''
                  }`}
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
      const calculatedScores = calculateHandScore(sanitizedPlayers);
      
      console.log('Hand scores calculated:', calculatedScores);
      
      // Set the hand scores and show the modal
      setCurrentHandSummary({
        team1Score: { ...calculatedScores.team1Score, team: 1 as const },
        team2Score: { ...calculatedScores.team2Score, team: 2 as const },
        totalScores: {
          team1: (game.scores.team1 || 0) + calculatedScores.team1Score.score,
          team2: (game.scores.team2 || 0) + calculatedScores.team2Score.score
        }
      });
      setShowHandSummary(true);
    };
    
    // Register event listener for hand completion
    socket.on('hand_completed', handleHandCompleted);
    
    // Handle scoring state change directly in case the server doesn't emit the event
    if (game.status === "PLAYING" && sanitizedPlayers.every((p: Player) => p.hand.length === 0) && !showHandSummary) {
      handleHandCompleted();
    }
    
    return () => {
      socket.off('hand_completed', handleHandCompleted);
    };
  }, [socket, game.id, game.status, sanitizedPlayers, showHandSummary]);

  // Initialize the global variable
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.lastCompletedTrick = null;
    }
  }, []);

  // Fix completed tricks check
  const hasCompletedTricks = game.completedTricks.length > 0;

  // Calculate scores
  const team1Score = game?.scores?.['team1'] ?? 0;
  const team2Score = game?.scores?.['team2'] ?? 0;
  const team1Bags = game?.team1Bags ?? 0;
  const team2Bags = game?.team2Bags ?? 0;

  // Utility function to get player for a card if the mapping is missing that card
  const getPlayerForCardIndex = (index: number, existingMapping: Record<string, string>) => {
    // First, try to get from the existing mapping
    const playerId = existingMapping[index.toString()];
    if (playerId) {
      const player = sanitizedPlayers.find((p: Player) => p.id === playerId);
      if (player) return player;
    }
    
    // If we don't have a mapping for this card, we need to deduce who played it
    // We can do this by working backward from the current player (next to play)
    const currentPlayerInfo = sanitizedPlayers.find((p: Player) => p.id === game.currentPlayer);
    if (!currentPlayerInfo || currentPlayerInfo.position === undefined) return null;
    
    // For a complete trick, we know the player who is due to play next
    // won the trick with their card
    if (currentTrick.length === 4) {
      // Find how many positions back we need to go from current player
      const stepsBack = currentTrick.length - index;
      const position = (currentPlayerInfo.position - stepsBack + 4) % 4;
      return sanitizedPlayers.find((p: Player) => p.position === position) || null;
    }
    
    // For an in-progress trick, the player who played this card is
    // the player who is (trick.length - index) positions before the current player
    const stepsBack = currentTrick.length - index;
    const position = (currentPlayerInfo.position - stepsBack + 4) % 4;
    return sanitizedPlayers.find((p: Player) => p.position === position) || null;
  };

  // Update cardPlayers when game state changes
  useEffect(() => {
    if (game.cardPlayers) {
      setCardPlayers(game.cardPlayers);
    }
  }, [game.cardPlayers]);

  // Effect to handle game completion
  useEffect(() => {
    if (!socket) return;

    const handleGameOver = (data: { team1Score: number; team2Score: number; winningTeam: 1 | 2 }) => {
      console.log('Game over event received:', data);
      setShowHandSummary(false);
      setCurrentHandSummary(null);
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
    if (game.status === "FINISHED") {
      const winningTeam = game.winningTeam === "team1" ? 1 : 2;
      setShowHandSummary(false);
      setCurrentHandSummary(null);
      if (winningTeam === 1) {
        setShowWinner(true);
      } else {
        setShowLoser(true);
      }
    }
  }, [game.status, game.winningTeam]);

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
      const isMobile = windowSize.width < 640;
      const trickCardWidth = windowSize.width < 640 ? 25 : Math.floor(96 * getScaleFactor());
      const trickCardHeight = windowSize.width < 640 ? 38 : Math.floor(144 * getScaleFactor());

      return (
        <div
          key={`${card.suit}-${card.rank}-${index}`}
          className={`${positions[relativePosition]} z-10 transition-all duration-500
            ${isWinningCard ? 'ring-2 ring-yellow-400 scale-110 z-20' : ''}`}
          style={{
            width: `${trickCardWidth}px`,
            height: `${trickCardHeight}px`,
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

  const [playersWantToPlayAgain, setPlayersWantToPlayAgain] = useState<Set<string>>(new Set());

  const handlePlayAgain = () => {
    if (!socket) return;
    socket.emit('play_again', { gameId: game.id });
  };

  useEffect(() => {
    if (!socket) return;

    socket.on('player_wants_to_play_again', (data: { playerId: string }) => {
      const { playerId } = data;
      setPlayersWantToPlayAgain(prev => new Set([...prev, playerId]));
    });

    socket.on('game_restarting', () => {
      setPlayersWantToPlayAgain(new Set());
      // Reset game state
      setCurrentHandSummary(null);
      setShowHandSummary(false);
      setShowWinner(false);
      setShowLoser(false);
      if (socket) {
        socket.emit('leave_game', { gameId: game.id, userId: propUser?.id });
      }
      onLeaveTable();
    });

    return () => {
      socket.off('player_wants_to_play_again');
      socket.off('game_restarting');
    };
  }, [socket, propUser?.id, onLeaveTable]);

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
                    <div className="absolute left-0 mt-2 w-56 bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl p-4 z-50 text-sm text-white">
                      <div className="font-bold mb-2 flex items-center gap-2">
                        <IoInformationCircleOutline className="inline-block h-4 w-4 text-blue-400" />
                        Table Details
                      </div>
                      <div className="flex flex-col gap-1">
                        <div><span className="text-gray-400">Type:</span> {game.rules?.gameType || 'REGULAR'}</div>
                        <div><span className="text-gray-400">Points:</span> {game.maxPoints ?? 500}/{game.minPoints ?? -150}</div>
                        {(game.rules?.gameType === 'REGULAR' || game.rules?.gameType === 'SOLO') && (
                          <>
                            <div><span className="text-gray-400">Nil:</span> {game.rules?.allowNil ? '✅ Allowed' : '❌ Not allowed'}</div>
                            <div><span className="text-gray-400">Blind Nil:</span> {game.rules?.allowBlindNil ? '✅ Allowed' : '❌ Not allowed'}</div>
                          </>
                        )}
                        <div className="mt-2 pt-2 border-t border-gray-700">
                          <div className="text-sm">
                            <span className="text-gray-400">Buy-in:</span>
                            <span className="font-bold text-yellow-400 ml-2">{game.rules?.coinAmount ? `${(game.rules.coinAmount / 1000)}k` : '100k'}</span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-400">Prize Pool:</span>
                            <span className="font-bold text-yellow-400 ml-2">{game.rules?.coinAmount ? `${((game.rules.coinAmount * 4 * 0.9) / 1000)}k` : '360k'}</span>
                          </div>
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
              <div className="absolute inset-0 flex items-center justify-center">
                {game.status === "WAITING" && sanitizedPlayers.length === 4 && sanitizedPlayers[0]?.id === currentPlayerId ? (
                  <button
                    onClick={handleStartGame}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-bold rounded-lg shadow-lg transform hover:scale-105 transition-all"
                    style={{ fontSize: `${Math.floor(16 * scaleFactor)}px` }}
                  >
                    Start Game
                  </button>
                ) : game.status === "WAITING" && sanitizedPlayers.length < 4 ? (
                  <div className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-center"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    <div className="font-bold">Waiting for Players</div>
                    <div className="text-sm mt-1">{sanitizedPlayers.length}/4 joined</div>
                  </div>
                ) : game.status === "WAITING" && sanitizedPlayers[0]?.id !== currentPlayerId ? (
                  <div className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-center"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    <div className="font-bold">Waiting for Host</div>
                    <div className="text-sm mt-1">Only {sanitizedPlayers[0]?.name} can start</div>
                  </div>
                ) : game.status === "BIDDING" && game.currentPlayer === currentPlayerId ? (
                  <div className="flex items-center justify-center w-full h-full">
                    <BiddingInterface
                      onBid={handleBid}
                      currentBid={orderedPlayers[0]?.bid}
                      gameId={game.id}
                      playerId={currentPlayerId}
                      currentPlayerTurn={game.currentPlayer}
                      gameType={game.rules.gameType}
                      numSpades={currentPlayer ? countSpades(currentPlayer.hand) : 0}
                      isCurrentPlayer={game.currentPlayer === currentPlayerId}
                      allowNil={game.rules.allowNil}
                    />
                  </div>
                ) : game.status === "BIDDING" && game.currentPlayer !== currentPlayerId ? (
                  <div className="px-4 py-2 bg-gray-700 text-white rounded-lg text-center animate-pulse"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    {(() => {
                      const waitingPlayer = sanitizedPlayers.find((p: Player) => p.id === game.currentPlayer);
                      return (
                        <div className="font-bold">Waiting for {waitingPlayer ? waitingPlayer.name : "Unknown"} to bid</div>
                      );
                    })()}
                  </div>
                ) : game.status === "PLAYING" && currentTrick?.length === 0 ? (
                  <div className="px-4 py-2 bg-gray-700/70 text-white rounded-lg text-center"
                       style={{ fontSize: `${Math.floor(14 * scaleFactor)}px` }}>
                    {(() => {
                      const waitingPlayer = sanitizedPlayers.find((p: Player) => p.id === game.currentPlayer);
                      return (
                        <div className="text-sm">Waiting for {waitingPlayer ? waitingPlayer.name : "Unknown"} to play</div>
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
            <Chat 
              socket={socket}
              gameId={game.id}
              userId={currentPlayerId || ''}
              userName={currentPlayer?.name || 'Unknown'}
              players={sanitizedPlayers}
            />
          </div>
        </div>

        {/* Hand Summary Modal - Pass currentHandSummary */}
        {showHandSummary && (
          <HandSummaryModal
            isOpen={showHandSummary}
            onClose={() => {
              setShowHandSummary(false);
              setCurrentHandSummary(null);
            }}
            handScores={currentHandSummary}
            minPoints={game.minPoints ?? -150}
            maxPoints={game.maxPoints ?? 500}
            onGameOver={(winner) => {
              setShowHandSummary(false);
              setCurrentHandSummary(null);
              if (winner === 1) {
                setShowWinner(true);
              } else {
                setShowLoser(true);
              }
            }}
          />
        )}

        {/* Winner Modal */}
        {showWinner && (
          <WinnerModal
            isOpen={true}
            onClose={handleLeaveTable}
            team1Score={game.scores.team1}
            team2Score={game.scores.team2}
            winningTeam={1}
            onPlayAgain={handlePlayAgain}
          />
        )}

        {/* Loser Modal */}
        {showLoser && (
          <LoserModal
            isOpen={true}
            onClose={handleLeaveTable}
            team1Score={game.scores.team1}
            team2Score={game.scores.team2}
            winningTeam={2}
            onPlayAgain={handlePlayAgain}
          />
        )}
      </div>
    </>
  );
}