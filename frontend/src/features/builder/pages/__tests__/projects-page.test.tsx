// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectsPage from '../projects-page';
import { BrowserRouter } from 'react-router-dom';
import { buildApi } from '../../api/builds';
import { useAuth } from '../../../admin/hooks/use-auth';
import { toast } from 'sonner';
import { ApiError } from '../../../../lib/api';

// Mock dependencies
vi.mock('../../../admin/hooks/use-auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../api/builds', () => ({
  buildApi: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn(),
    updateTopology: vi.fn(),
    calculateNetwork: vi.fn(),
    validateNetwork: vi.fn(),
  },
}));

vi.mock('../../../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => (
    <button
      onClick={e => {
        e.stopPropagation();
        if (onClick) onClick(e);
      }}
    >
      {children}
    </button>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../store/builder-store', () => ({
  useBuilderStore: vi.fn(() => ({
    loadBuild: vi.fn(),
  })),
}));

// Mock URL object methods
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();
URL.createObjectURL = mockCreateObjectURL;
URL.revokeObjectURL = mockRevokeObjectURL;

describe('ProjectsPage Export Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectURL.mockReturnValue('blob:fake-url');

    // Mock authenticated user
    (useAuth as any).mockReturnValue({
      user: { id: '1', email: 'test@example.com' },
    });
  });

  it('uses Guided Planner as the only assisted project-start path', async () => {
    (buildApi.list as any).mockResolvedValue([]);

    render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>,
    );

    const plannerLink = await screen.findByRole('link', { name: /Guided Planner/i });
    expect(plannerLink).toHaveAttribute('href', '/planner');
    expect(screen.queryByText(/Fast Start/i)).not.toBeInTheDocument();
  });

  it('exports a project matching the .homelab.json schema', async () => {
    // Mock a project in the database
    const mockBuild = {
      id: 'build-1',
      user_id: '1',
      name: 'Test Project',
      thumbnail: '',
      nodes: [{
        id: 'react-flow-1',
        details: { notes: 'Replace the fan next month.' },
        virtual_machines: [{ id: 'vm-1', name: 'Home Assistant', type: 'vm' }],
        internal_components: [],
      }],
      edges: [{ id: 'edge-1', source_node_id: 'react-flow-1', target_node_id: 'router-1' }],
      settings: { boughtItems: ['switch'], showBought: true, tags: [{ id: 'tag-1', name: 'Core' }] },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockBuildList = [{ ...mockBuild }];

    (buildApi.list as any).mockResolvedValue(mockBuildList);
    (buildApi.get as any).mockResolvedValue(mockBuild);

    render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>,
    );

    // Wait for projects to load
    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });

    // Click the Export button directly (Dropdown content is mocked to always render)
    const exportBtn = await screen.findByText(/Export/i);
    fireEvent.click(exportBtn);

    // Verify that a Blob was created (using waitFor since handleExport is now async)
    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    });

    // Verify the Blob contents
    const blobArg = mockCreateObjectURL.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);

    const text = await blobArg.text();
    const payload = JSON.parse(text);

    // Verify schema compliance
    expect(payload).toHaveProperty('version', 1);
    expect(payload).toHaveProperty('name', 'Test Project');
    expect(payload).toHaveProperty('exportedAt');
    expect(payload.nodes).toHaveLength(1);
    expect(payload.nodes[0].details.notes).toBe('Replace the fan next month.');
    expect(payload.nodes[0].vms[0].id).toBe('vm-1');
    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0]).toMatchObject({ source: 'react-flow-1', target: 'router-1' });
    expect(payload.settings.tags).toEqual([{ id: 'tag-1', name: 'Core' }]);
    expect(payload).toHaveProperty('boughtItems');
    expect(payload).toHaveProperty('showBought');
  });

  it('imports exported database-shaped nodes and edges with notes intact', async () => {
    (buildApi.list as any).mockResolvedValue([]);
    (buildApi.create as any).mockResolvedValue({ id: 'roundtrip-build', name: 'Roundtrip', revision: 1 });
    (buildApi.updateTopology as any).mockResolvedValue({
      build: { id: 'roundtrip-build', name: 'Roundtrip', revision: 2, nodes: [] },
      validation: { valid: true, errors: [], warnings: [] },
    });

    const { container } = render(<BrowserRouter><ProjectsPage /></BrowserRouter>);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const readAsTextSpy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function () {
      this.onload?.({ target: { result: JSON.stringify({
        version: 1,
        name: 'Roundtrip',
        nodes: [
          { id: 'router-1', type: 'router', name: 'Router', details: {} },
          {
            id: 'server-1', type: 'server_v2', name: 'Server',
            details: { notes: 'Keep this node cool.' },
            virtual_machines: [{ id: 'vm-1', name: 'Media', type: 'vm' }],
            internal_components: [],
          },
        ],
        edges: [{ id: 'edge-1', source_node_id: 'router-1', target_node_id: 'server-1', type: 'ethernet' }],
        settings: { tags: [{ id: 'tag-1', name: 'Core' }] },
      }) } } as any);
    });

    fireEvent.change(fileInput, {
      target: { files: [new File(['ignored'], 'Roundtrip.homelab.json', { type: 'application/json' })] },
    });
    await waitFor(() => expect(screen.getByText('Create New Project')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Create Project').at(-1) as HTMLElement);

    await waitFor(() => expect(buildApi.updateTopology).toHaveBeenCalled());
    const imported = (buildApi.updateTopology as any).mock.calls[0][1];
    expect(imported.nodes[1].details.notes).toBe('Keep this node cool.');
    expect(imported.nodes[1].vms[0]).toMatchObject({ name: 'Media', type: 'vm' });
    expect(imported.nodes[0].id).not.toBe('router-1');
    expect(imported.nodes[1].id).not.toBe('server-1');
    expect(imported.nodes[1].vms[0].id).not.toBe('vm-1');
    expect(imported.edges[0]).toMatchObject({ source: imported.nodes[0].id, target: imported.nodes[1].id });
    expect(imported.settings.tags).toEqual([{ id: 'tag-1', name: 'Core' }]);
    readAsTextSpy.mockRestore();
  });

  it('filters invalid imported edges and warns while allowing partial import', async () => {
    (buildApi.list as any).mockResolvedValue([]);
    (buildApi.create as any).mockResolvedValue({
      id: 'new-build',
      name: 'Imported Build',
      revision: 1,
    });
    (buildApi.updateTopology as any).mockResolvedValue({
      build: { id: 'new-build', name: 'Imported Build', revision: 2, nodes: [] },
      validation: { valid: true, errors: [], warnings: [] },
    });

    const { container } = render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const readAsTextSpy = vi
      .spyOn(FileReader.prototype, 'readAsText')
      .mockImplementation(function () {
        const payload = JSON.stringify({
          nodes: [
            { id: 'router-1', type: 'router', name: 'Router' },
            { id: 'pc-1', type: 'pc', name: 'PC' },
          ],
          edges: [
            { source: 'router-1', target: 'pc-1', speed: '1 GbE' },
            { source: 'router-1', target: 'missing-node', speed: '1 GbE' },
          ],
        });
        this.onload?.({ target: { result: payload } } as any);
      });

    const importFile = new File(['ignored'], 'import.homelab.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [importFile] } });

    await waitFor(() => {
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Create Project').at(-1) as HTMLElement);

    await waitFor(() => {
      expect(buildApi.create).toHaveBeenCalled();
    });

    expect((buildApi.create as any).mock.calls[0][0].nodes).toHaveLength(0);
    const topologyArgs = (buildApi.updateTopology as any).mock.calls[0][1];
    expect(topologyArgs.revision).toBe(1);
    expect(topologyArgs.nodes).toHaveLength(2);
    expect(topologyArgs.edges).toHaveLength(1);
    expect(topologyArgs.edges[0].target).toBe(topologyArgs.nodes[1].id);
    expect(topologyArgs.nodes[0].id).not.toBe('router-1');
    expect(toast.warning).toHaveBeenCalled();

    readAsTextSpy.mockRestore();
  });

  it('shows a specific error when backend rejects invalid edge references', async () => {
    (buildApi.list as any).mockResolvedValue([]);
    (buildApi.create as any).mockResolvedValue({
      id: 'new-build',
      name: 'Imported Build',
      revision: 1,
    });
    (buildApi.updateTopology as any).mockRejectedValue(
      new ApiError(400, 'UNKNOWN', 'invalid edge references: 1 edge(s) reference missing node(s)'),
    );

    const { container } = render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const readAsTextSpy = vi
      .spyOn(FileReader.prototype, 'readAsText')
      .mockImplementation(function () {
        const payload = JSON.stringify({
          nodes: [{ id: 'router-1', type: 'router', name: 'Router' }],
          edges: [],
        });
        this.onload?.({ target: { result: payload } } as any);
      });

    fireEvent.change(fileInput, {
      target: {
        files: [new File(['ignored'], 'import.homelab.json', { type: 'application/json' })],
      },
    });
    await waitFor(() => {
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText('Create Project').at(-1) as HTMLElement);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Import failed: wiring references missing nodes. Re-export and retry.',
      );
    });
    expect(buildApi.delete).toHaveBeenCalledWith('new-build');
    readAsTextSpy.mockRestore();
  });
});
