/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert, expect } from 'chai';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { buildIconLabel, commandThemeIcon, stripIconLabel } from './utils';

describe('buildIconLabel', () => {
  it('builds an icon label for commands with one', () => {
    expect(buildIconLabel({ label: 'foo', icon: 'trash' })).to.equal(
      '$(trash)  foo',
    );
  });

  it('builds an icon label omitting the icon for commands without one', () => {
    expect(buildIconLabel({ label: 'foo' })).to.equal('foo');
  });
});

describe('stripIconLabel', () => {
  it('strips the icon from labels with one', () => {
    expect(stripIconLabel('$(trash)  foo')).to.equal('foo');
  });

  it('no-ops for labels without an icon prefix', () => {
    expect(stripIconLabel('foo')).to.equal('foo');
  });
});

describe('commandThemeIcon', () => {
  let vs: VsCodeStub;

  beforeEach(() => {
    vs = newVsCodeStub();
  });

  it('returns a theme icon for commands with one', () => {
    const icon = commandThemeIcon(vs.asVsCode(), {
      label: 'foo',
      icon: 'trash',
    });

    assert(icon);
    expect(icon.id).to.equal('trash');
  });

  it('returns undefined for commands without an icon', () => {
    const icon = commandThemeIcon(vs.asVsCode(), {
      label: 'foo',
    });

    expect(icon).to.be.undefined;
  });
});
