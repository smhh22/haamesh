import { markdownToFragment } from '@hamesh/engine';
import { useMemo } from 'react';

interface MarkdownViewProps {
  source: string;
  /**
   * Release notes are English and must stay LTR even in the Persian UI;
   * user notes default to per-content direction.
   */
  dir?: 'ltr' | 'rtl' | 'auto';
  className?: string;
}

/**
 * Renders trusted-shaped Markdown as sanitized HTML. Anchors are inert (the
 * engine strips hrefs), so no click can navigate the app window.
 */
export const MarkdownView = ({ source, dir = 'auto', className }: MarkdownViewProps) => {
  const html = useMemo(() => markdownToFragment(source), [source]);
  return (
    <div
      className={className ? `md-viewer ${className}` : 'md-viewer'}
      dir={dir}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: engine-sanitized fragment; anchors are inert
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
