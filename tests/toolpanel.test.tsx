import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToolPanel from '../entrypoints/sidepanel/components/ToolPanel';

describe('ToolPanel', () => {
  it('渲染 logo / title / subtitle / children', () => {
    render(
      <ToolPanel logo={<span data-testid="lg" />} title="Ahrefs" subtitle="关键词难度查询">
        <span>表单区</span>
      </ToolPanel>,
    );
    expect(screen.getByTestId('lg')).toBeInTheDocument();
    expect(screen.getByText('Ahrefs')).toBeInTheDocument();
    expect(screen.getByText('关键词难度查询')).toBeInTheDocument();
    expect(screen.getByText('表单区')).toBeInTheDocument();
  });
  it('subtitle 可选', () => {
    render(<ToolPanel logo={<span />} title="T"><i>x</i></ToolPanel>);
    expect(screen.getByText('T')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).toBeNull();
  });
  it('传 action 时渲染到 header 区域', () => {
    render(
      <ToolPanel logo={<span />} title="T" action={<button type="button">动作</button>}>
        <i>x</i>
      </ToolPanel>,
    );
    expect(screen.getByText('动作')).toBeInTheDocument();
  });
});
