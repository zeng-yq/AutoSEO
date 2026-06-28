import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo, GscMark, BingMark, IconSubmit, IconRobots, IconSitemap, IconSettings, IconBack, IconClose, IconChevron } from '../entrypoints/sidepanel/components/icons';

describe('icons', () => {
  const all = { Logo, GscMark, BingMark, IconSubmit, IconRobots, IconSitemap, IconSettings, IconBack, IconClose, IconChevron };
  for (const [name, Comp] of Object.entries(all)) {
    it(`${name} 渲染一个 svg`, () => {
      const { container } = render(<Comp />);
      expect(container.querySelector('svg')).toBeTruthy();
    });
  }
  it('Logo 接受 size', () => {
    const { container } = render(<Logo size={24} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('24');
  });
});
