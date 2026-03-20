/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { ColabAssignedServer } from '../../jupyter/servers';
import { ResourceItem, ResourceType } from './resource-item';

describe('ResourceItem', () => {
  const SERVER_ENDPOINT = 'colab-server-1';

  describe('fromServer', () => {
    it('constructs a server resource item', () => {
      const server = {
        endpoint: SERVER_ENDPOINT,
        label: 'Colab Server 1',
      } as ColabAssignedServer;

      const resourceItem = ResourceItem.fromServer(server);

      expect(resourceItem).to.deep.equal(
        new ResourceItem(SERVER_ENDPOINT, server.label, ResourceType.SERVER),
      );
    });
  });

  describe('fromMemory', () => {
    it('constructs a memory resource item', () => {
      const resourceItem = ResourceItem.fromMemory(SERVER_ENDPOINT, {
        totalBytes: 100 * 1024 * 1024 * 1024,
        freeBytes: 80 * 1024 * 1024 * 1024,
      });

      expect(resourceItem).to.deep.equal(
        new ResourceItem(
          SERVER_ENDPOINT,
          /* label= */ 'System RAM: 20.00 / 100.00 GB',
          ResourceType.RAM,
          /* tooltip= */ '20.00%',
        ),
      );
    });

    it('constructs a memory resource item with 0 bytes', () => {
      const resourceItem = ResourceItem.fromMemory(SERVER_ENDPOINT, {
        totalBytes: 0,
        freeBytes: 0,
      });

      expect(resourceItem).to.deep.equal(
        new ResourceItem(
          SERVER_ENDPOINT,
          /* label= */ 'System RAM: 0.00 / 0.00 GB',
          ResourceType.RAM,
        ),
      );
    });
  });

  describe('fromDisk', () => {
    const tests = [
      { name: 'without label', label: undefined, expectedLabel: 'Disk:' },
      { name: 'with empty label', label: '', expectedLabel: 'Disk:' },
      { name: 'with kernel label', label: 'kernel', expectedLabel: 'Disk:' },
      {
        name: 'with non-path label',
        label: 'dsa',
        expectedLabel: 'Disk [ dsa ]:',
      },
      {
        name: 'with path label',
        label: '/dev/sda',
        expectedLabel: 'Disk [ sda ]:',
      },
    ];
    tests.forEach(({ name, label, expectedLabel }) => {
      it(`constructs a disk resource item ${name}`, () => {
        const resourceItem = ResourceItem.fromDisk(SERVER_ENDPOINT, {
          filesystem: {
            label,
            totalBytes: 100 * 1024 * 1024 * 1024,
            usedBytes: 80 * 1024 * 1024 * 1024,
          },
        });

        expect(resourceItem).to.deep.equal(
          new ResourceItem(
            SERVER_ENDPOINT,
            /* label= */ `${expectedLabel} 80.00 / 100.00 GB`,
            ResourceType.DISK,
            /* tooltip= */ '80.00%',
          ),
        );
      });
    });

    it('constructs a disk resource item with 0 bytes', () => {
      const resourceItem = ResourceItem.fromDisk(SERVER_ENDPOINT, {
        filesystem: {
          label: 'kernel',
          totalBytes: 0,
          usedBytes: 0,
        },
      });

      expect(resourceItem).to.deep.equal(
        new ResourceItem(
          SERVER_ENDPOINT,
          /* label= */ 'Disk: 0.00 / 0.00 GB',
          ResourceType.DISK,
        ),
      );
    });
  });

  describe('fromGpus', () => {
    it('constructs a GPU resource item', () => {
      const resourceItem = ResourceItem.fromGpus(SERVER_ENDPOINT, [
        {
          memoryTotalBytes: 100 * 1024 * 1024 * 1024,
          memoryUsedBytes: 80 * 1024 * 1024 * 1024,
        },
      ]);

      expect(resourceItem).to.deep.equal(
        new ResourceItem(
          SERVER_ENDPOINT,
          /* label= */ 'GPU RAM: 80.00 / 100.00 GB',
          ResourceType.GPU,
          /* tooltip= */ '80.00%',
        ),
      );
    });

    it('constructs a GPU resource item from multiple GPUs', () => {
      const resourceItem = ResourceItem.fromGpus(SERVER_ENDPOINT, [
        {
          memoryTotalBytes: 100 * 1024 * 1024 * 1024,
          memoryUsedBytes: 80 * 1024 * 1024 * 1024,
        },
        {
          memoryTotalBytes: 100 * 1024 * 1024 * 1024,
          memoryUsedBytes: 20 * 1024 * 1024 * 1024,
        },
      ]);

      expect(resourceItem).to.deep.equal(
        new ResourceItem(
          SERVER_ENDPOINT,
          /* label= */ 'GPU RAM: 100.00 / 200.00 GB',
          ResourceType.GPU,
          /* tooltip= */ '50.00%',
        ),
      );
    });

    it('constructs a GPU resource item with 0 bytes', () => {
      const resourceItem = ResourceItem.fromGpus(SERVER_ENDPOINT, [
        {
          memoryTotalBytes: 0,
          memoryUsedBytes: 0,
        },
      ]);

      expect(resourceItem).to.deep.equal(
        new ResourceItem(
          SERVER_ENDPOINT,
          /* label= */ 'GPU RAM: 0.00 / 0.00 GB',
          ResourceType.GPU,
        ),
      );
    });

    it('constructs a GPU resource item with no GPUs', () => {
      const resourceItem = ResourceItem.fromGpus(SERVER_ENDPOINT, []);

      expect(resourceItem).to.deep.equal(
        new ResourceItem(
          SERVER_ENDPOINT,
          /* label= */ 'GPU RAM: 0.00 / 0.00 GB',
          ResourceType.GPU,
        ),
      );
    });
  });
});
