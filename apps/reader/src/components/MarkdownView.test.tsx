import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownView } from './MarkdownView';

describe('MarkdownView', () => {
  it('renders markdown structure', () => {
    render(<MarkdownView source={'# Title\n\n- a\n- b'} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title');
    expect(document.querySelectorAll('.md-viewer li')).toHaveLength(2);
  });

  it('renders anchors as inert text and never injects handlers', () => {
    render(<MarkdownView source={'[site](https://example.com)\n\n<script>alert(1)</script>'} />);
    const anchor = document.querySelector('.md-viewer a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBeNull();
    expect(document.querySelector('.md-viewer script')).toBeNull();
  });

  it('forces LTR for release notes', () => {
    render(<MarkdownView source="notes" dir="ltr" />);
    expect(document.querySelector('.md-viewer')).toHaveAttribute('dir', 'ltr');
  });
});
