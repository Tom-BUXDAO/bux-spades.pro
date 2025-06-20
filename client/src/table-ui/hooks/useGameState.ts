import { useState, useEffect, useCallback } from 'react';
// import { useSocket } from '../lib/socket';
import type { GameState } from '../../types/game';
// import type { Player, Card } from '../../types/game';
// import type { GameRules } from '@/components/lobby/GameRulesModal';

export type GameType = 'REGULAR' | 'WHIZ' | 'SOLO' | 'MIRROR';

/**
 * Hook to manage game state with Socket.IO
 * @param gameId - ID of the game to connect to
 * @param userId - Current user's ID
 * @returns game state and methods to interact with the game
 */
export function useGameState(
  _gameId: string,
  _userId: string
) {
  // const { socket } = useSocket(gameId); // Use our custom socket hook
  const [gameState] = useState<GameState | null>(null);
  const [error] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  // Join game
  const joinGame = useCallback(() => {
    // if (!socket) return;
    
    setIsLoading(true);
    // socket.emit('join_game', { gameId, userId });
  }, []);
  
  // Leave game
  const leaveGame = useCallback(() => {}, []);
  
  // Make a bid
  const makeBid = useCallback(() => {}, []);
  
  // Play a card
  const playCard = useCallback(() => {}, []);
  
  // Listen for game updates
  useEffect(() => {
    // if (!socket) return;
    
    // Join the game when socket is ready
    // if (socket.connected) {
      joinGame();
    // }
    
    // Setup event listeners
    // socket.on('connect', joinGame);
    // socket.on('game_update', onGameUpdate);
    // socket.on('error', onGameError);
    
    // Cleanup
    // return () => {
    //   socket.off('connect', joinGame);
    //   socket.off('game_update', onGameUpdate);
    //   socket.off('error', onGameError);
    // };
  }, []);
  
  return {
    gameState,
    error,
    isLoading,
    joinGame,
    leaveGame,
    makeBid,
    playCard
  };
}

export default useGameState; 