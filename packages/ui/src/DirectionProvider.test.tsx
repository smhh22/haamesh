import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DirectionProvider, useDirection } from './DirectionProvider';

const Probe = () => <span data-testid="direction">{useDirection()}</span>;

describe('DirectionProvider', () => {
  it('exposes the direction to descendants', () => {
    render(
      <DirectionProvider dir="rtl">
        <Probe />
      </DirectionProvider>,
    );
    expect(screen.getByTestId('direction')).toHaveTextContent('rtl');
  });

  it('defaults to ltr outside a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('direction')).toHaveTextContent('ltr');
  });
});
