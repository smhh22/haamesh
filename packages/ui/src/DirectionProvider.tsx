import type { Direction } from '@hamesh/core';
import { DirectionProvider as RadixDirectionProvider } from '@radix-ui/react-direction';
import { createContext, type ReactNode, useContext } from 'react';

const DirectionContext = createContext<Direction>('ltr');

export interface DirectionProviderProps {
  dir: Direction;
  children: ReactNode;
}

export const DirectionProvider = ({ dir, children }: DirectionProviderProps) => (
  <RadixDirectionProvider dir={dir}>
    <DirectionContext.Provider value={dir}>{children}</DirectionContext.Provider>
  </RadixDirectionProvider>
);

export const useDirection = (): Direction => useContext(DirectionContext);
