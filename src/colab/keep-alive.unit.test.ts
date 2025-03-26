import { randomUUID } from "crypto";
import sinon, { SinonFakeTimers, SinonStubbedInstance } from "sinon";
import { AssignmentManager } from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { TestCancellationTokenSource } from "../test/helpers/cancellation";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { Accelerator, Kernel, Variant } from "./api";
import { ColabClient } from "./client";
import { ServerKeepAliveController } from "./keep-alive";

const NOW = new Date();
const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = ONE_SECOND_MS * 60;
const ABORTING_KEEP_ALIVE = async (
  _: string,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new Error("Aborted"));
    });
  });

const CONFIG = {
  inactivityThresholdMs: ONE_MINUTE_MS * 60, // 1 hour.
  keepAliveIntervalMs: ONE_MINUTE_MS * 5, // 5 minutes.
  idleExtensionPromptTimeMs: ONE_SECOND_MS * 10, // 10 seconds.
  idleExtensionMs: ONE_MINUTE_MS * 30, // 30 minutes.
};

const DEFAULT_KERNEL: Kernel = {
  id: "456",
  name: "Kermit the Kernel",
  lastActivity: new Date(NOW.getTime() - ONE_MINUTE_MS).toString(),
  executionState: "idle",
  connections: 1,
};

describe("ServerKeepAliveController", () => {
  let clock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let defaultServer: ColabAssignedServer;
  let serverKeepAliveController: ServerKeepAliveController;

  async function tickPast(ms: number) {
    await clock.tickAsync(ms + 1);
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout"],
    });
    clock.setSystemTime(NOW);
    vsCodeStub = newVsCodeStub();
    colabClientStub = sinon.createStubInstance(ColabClient);
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    defaultServer = {
      id: randomUUID(),
      label: "Colab GPU A100",
      variant: Variant.GPU,
      accelerator: Accelerator.A100,
      endpoint: "m-s-foo",
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse("https://example.com"),
        token: "123",
        headers: {
          "X-Colab-Runtime-Proxy-Token": "123",
          "X-Colab-Client-Agent": "vscode",
        },
      },
    };
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
    serverKeepAliveController.dispose();
  });

  describe("lifecycle", () => {
    it("disposes the interval timeout", async () => {
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
      serverKeepAliveController.dispose();

      await tickPast(CONFIG.keepAliveIntervalMs);
      sinon.assert.notCalled(colabClientStub.keepAlive);
    });

    it("skips when a keep-alive is already in flight", async () => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      colabClientStub.listKernels
        .withArgs(defaultServer.endpoint)
        .resolves([DEFAULT_KERNEL]);
      colabClientStub.keepAlive.callsFake(ABORTING_KEEP_ALIVE);
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        {
          ...CONFIG,
          // Force the keep-alive to take longer than the interval.
          idleExtensionPromptTimeMs: CONFIG.keepAliveIntervalMs * 42,
        },
      );

      await tickPast(CONFIG.keepAliveIntervalMs);
      await tickPast(CONFIG.keepAliveIntervalMs);
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledOnce(colabClientStub.keepAlive);
    });

    it("aborts slow keep-alive attempts", async () => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      colabClientStub.listKernels
        .withArgs(defaultServer.endpoint)
        .resolves([DEFAULT_KERNEL]);
      colabClientStub.keepAlive.onFirstCall().callsFake(ABORTING_KEEP_ALIVE);
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );

      await tickPast(CONFIG.keepAliveIntervalMs);
      await tickPast(CONFIG.keepAliveIntervalMs);
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledThrice(colabClientStub.keepAlive);
    });
  });

  describe("with no assigned servers", () => {
    it("does nothing", async () => {
      assignmentStub.getAssignedServers.resolves([]);
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );

      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledOnce(assignmentStub.getAssignedServers);
      sinon.assert.notCalled(colabClientStub.listKernels);
      sinon.assert.notCalled(colabClientStub.keepAlive);
    });
  });

  describe('with an "active" server', () => {
    beforeEach(() => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      colabClientStub.listKernels
        .withArgs(defaultServer.endpoint)
        .resolves([DEFAULT_KERNEL]);
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
    });

    it("sends a keep-alive request", async () => {
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledOnce(colabClientStub.keepAlive);
      sinon.assert.calledWith(
        colabClientStub.keepAlive,
        defaultServer.endpoint,
      );
    });
  });

  describe('with an "idle" server', () => {
    const idleKernel: Kernel = {
      ...DEFAULT_KERNEL,
      lastActivity: new Date(
        NOW.getTime() - CONFIG.inactivityThresholdMs - 1,
      ).toString(),
    };
    let cancellationSource: TestCancellationTokenSource;
    let reportStub: sinon.SinonStub<
      [
        value: {
          message?: string;
          increment?: number;
        },
      ],
      void
    >;

    beforeEach(() => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      colabClientStub.listKernels
        .withArgs(defaultServer.endpoint)
        .resolves([idleKernel]);
      cancellationSource = new vsCodeStub.CancellationTokenSource();
      reportStub = sinon.stub();
      vsCodeStub.window.withProgress
        .withArgs(
          sinon.match({
            location: vsCodeStub.ProgressLocation.Notification,
            title: sinon.match(/idle/),
            cancellable: true,
          }),
          sinon.match.any,
        )
        .callsFake((_, task) =>
          task({ report: reportStub }, cancellationSource.token),
        );
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
    });

    it("prompts the user to keep it running", async () => {
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledOnce(vsCodeStub.window.withProgress);
    });

    it("counts down the time to extend", async () => {
      const increment =
        100 / (CONFIG.idleExtensionPromptTimeMs / ONE_SECOND_MS);
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledOnce(reportStub);
      sinon.assert.calledWith(reportStub.firstCall, {
        message: sinon.match(/10 seconds/),
        increment,
      });
      await tickPast(ONE_SECOND_MS);
      sinon.assert.calledTwice(reportStub);
      sinon.assert.calledWith(reportStub.secondCall, {
        message: sinon.match(/9 seconds/),
        increment,
      });
      await tickPast(ONE_SECOND_MS);
      sinon.assert.calledThrice(reportStub);
      sinon.assert.calledWith(reportStub.thirdCall, {
        message: sinon.match(/8 seconds/),
        increment,
      });
    });

    describe("which the user does not extend", () => {
      beforeEach(async () => {
        await tickPast(CONFIG.keepAliveIntervalMs);
        await tickPast(CONFIG.idleExtensionPromptTimeMs);
      });

      it("does not send keep-alive requests", () => {
        sinon.assert.notCalled(colabClientStub.keepAlive);
      });

      it("does not prompt for extension again", async () => {
        sinon.assert.calledOnce(vsCodeStub.window.withProgress);
        vsCodeStub.window.withProgress.resetHistory();

        await tickPast(CONFIG.idleExtensionPromptTimeMs);
        await tickPast(CONFIG.idleExtensionMs);

        sinon.assert.notCalled(vsCodeStub.window.withProgress);
        sinon.assert.notCalled(colabClientStub.keepAlive);
      });

      it("starts sending keep-alive requests when used again", async () => {
        sinon.assert.notCalled(colabClientStub.keepAlive);
        const activeKernel: Kernel = {
          ...idleKernel,
          lastActivity: NOW.toString(),
        };
        colabClientStub.listKernels
          .withArgs(defaultServer.endpoint)
          .resolves([activeKernel]);

        await tickPast(CONFIG.keepAliveIntervalMs);

        sinon.assert.calledOnce(colabClientStub.keepAlive);
      });
    });

    describe("which the user extends", () => {
      beforeEach(async () => {
        await tickPast(CONFIG.keepAliveIntervalMs);
        sinon.assert.calledOnce(reportStub);
        sinon.assert.calledOnce(vsCodeStub.window.withProgress);
        cancellationSource.cancel();
        await clock.runToLastAsync();
      });

      it("sends a keep-alive request", () => {
        // Once before the extension prompt, and once after.
        sinon.assert.calledTwice(colabClientStub.keepAlive);
      });

      describe("and then uses", () => {
        beforeEach(async () => {
          const activeKernel: Kernel = {
            ...idleKernel,
            lastActivity: NOW.toString(),
          };
          colabClientStub.listKernels
            .withArgs(defaultServer.endpoint)
            .resolves([activeKernel]);
          await tickPast(CONFIG.keepAliveIntervalMs);
        });

        it("sends a keep-alive request", () => {
          // Once before the extension prompt, once after and again after using
          // the kernel.
          sinon.assert.calledThrice(colabClientStub.keepAlive);
        });

        it("does not prompt to keep it running", () => {
          // Only the first prompt.
          sinon.assert.calledOnce(vsCodeStub.window.withProgress);
        });
      });
    });
  });

  describe('with a mix of "active" and "idle" servers', () => {
    function createServerWithKernel(
      n: number,
      activity: "idle" | "active",
    ): { server: ColabAssignedServer; kernel: Kernel } {
      const server = {
        ...defaultServer,
        id: randomUUID(),
        endpoint: `m-s-${n.toString()}`,
      };
      return { server, kernel: createKernel(server, activity) };
    }

    function createKernel(
      assignment: ColabAssignedServer,
      activity: "idle" | "active",
    ): Kernel {
      return {
        ...DEFAULT_KERNEL,
        id: assignment.id,
        lastActivity: new Date(
          NOW.getTime() +
            (activity === "active" ? 1 : -1) * CONFIG.inactivityThresholdMs -
            1,
        ).toString(),
      };
    }

    let active1: { server: ColabAssignedServer; kernel: Kernel };
    let active2: { server: ColabAssignedServer; kernel: Kernel };
    let idle1: { server: ColabAssignedServer; kernel: Kernel };
    let idle2: { server: ColabAssignedServer; kernel: Kernel };

    beforeEach(() => {
      active1 = createServerWithKernel(1, "active");
      active2 = createServerWithKernel(2, "active");
      idle1 = createServerWithKernel(3, "idle");
      idle2 = createServerWithKernel(4, "idle");
      const servers = [active1, active2, idle1, idle2];
      for (const { server, kernel } of servers) {
        colabClientStub.listKernels
          .withArgs(server.endpoint)
          .resolves([kernel]);
      }
      assignmentStub.getAssignedServers.resolves(servers.map((s) => s.server));
    });

    it('only prompts to "idle" servers', async () => {
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledTwice(vsCodeStub.window.withProgress);
      sinon.assert.calledWith(
        vsCodeStub.window.withProgress,
        sinon.match({ title: sinon.match(new RegExp(idle1.server.label)) }),
      );
      sinon.assert.calledWith(
        vsCodeStub.window.withProgress,
        sinon.match({ title: sinon.match(new RegExp(idle2.server.label)) }),
      );
    });

    it('only sends keep-alive requests for "active" and extended servers', async () => {
      const reportStub: sinon.SinonStub<
        [
          value: {
            message?: string;
            increment?: number;
          },
        ],
        void
      > = sinon.stub();
      const firstServerCancellation = new TestCancellationTokenSource();
      vsCodeStub.window.withProgress
        .onFirstCall()
        .callsFake((_, task) =>
          task({ report: reportStub }, firstServerCancellation.token),
        );
      // Extend only one of the idle servers after a few seconds of showing the
      // prompt.
      reportStub.onThirdCall().callsFake((_) => {
        firstServerCancellation.cancel();
      });
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
      await tickPast(CONFIG.keepAliveIntervalMs);
      // The prompt is cancelled on the third call (after 3 seconds).
      await tickPast(ONE_SECOND_MS * 3);

      sinon.assert.calledThrice(colabClientStub.keepAlive);
      sinon.assert.calledWith(
        colabClientStub.keepAlive,
        active1.server.endpoint,
      );
      sinon.assert.calledWith(
        colabClientStub.keepAlive,
        active2.server.endpoint,
      );
      sinon.assert.calledWith(colabClientStub.keepAlive, idle1.server.endpoint);
    });

    // This is important to validate that keep-alive requests continue to get
    // sent to all servers, even if one is failing.
    it("swallows keep-alive failures", async () => {
      colabClientStub.keepAlive.withArgs(active1.server.endpoint).rejects();
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledTwice(colabClientStub.keepAlive);
      sinon.assert.calledWith(
        colabClientStub.keepAlive,
        active1.server.endpoint,
      );
      sinon.assert.calledWith(
        colabClientStub.keepAlive,
        active2.server.endpoint,
      );
    });
  });

  describe("with a server that has multiple kernels", () => {
    it("respects the most recent kernel activity", async () => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      const kernels: Kernel[] = [
        DEFAULT_KERNEL,
        // An "idle" kernel.
        {
          ...DEFAULT_KERNEL,
          id: "789",
          lastActivity: new Date(42).toString(),
        },
      ];
      colabClientStub.listKernels
        .withArgs(defaultServer.endpoint)
        .resolves(kernels);
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.calledOnce(colabClientStub.keepAlive);
      sinon.assert.calledWith(
        colabClientStub.keepAlive,
        defaultServer.endpoint,
      );
    });

    it("does not send a keep-alive request if all kernels are idle", async () => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      const kernels: Kernel[] = [
        {
          ...DEFAULT_KERNEL,
          id: "789",
          lastActivity: new Date(42).toString(),
        },
        {
          ...DEFAULT_KERNEL,
          id: "987",
          lastActivity: new Date(43).toString(),
        },
      ];
      colabClientStub.listKernels
        .withArgs(defaultServer.endpoint)
        .resolves(kernels);
      serverKeepAliveController = new ServerKeepAliveController(
        vsCodeStub.asVsCode(),
        colabClientStub,
        assignmentStub,
        CONFIG,
      );
      await tickPast(CONFIG.keepAliveIntervalMs);

      sinon.assert.notCalled(colabClientStub.keepAlive);
    });
  });
});
