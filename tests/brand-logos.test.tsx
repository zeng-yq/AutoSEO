import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AhrefsLogo, GoogleTrendsLogo, GoogleLogo, BingLogo } from '../entrypoints/sidepanel/components/brand-logos';

describe('brand-logos', () => {
  const all = { AhrefsLogo, GoogleTrendsLogo, GoogleLogo, BingLogo };
  for (const [name, Comp] of Object.entries(all)) {
    it(`${name} 渲染一个 svg`, () => {
      const { container } = render(<Comp />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  }
  it('接受 size', () => {
    const { container } = render(<GoogleLogo size={24} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('24');
  });
});
