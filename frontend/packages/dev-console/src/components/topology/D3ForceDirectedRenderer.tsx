/* eslint-disable react/no-multi-comp */
import * as React from 'react';
import * as d3 from 'd3';
import * as ReactDOM from 'react-dom';
import * as _ from 'lodash';
import { confirmModal, errorModal } from '@console/internal/components/modals';
import SvgDefsProvider from '../svg/SvgDefsProvider';
import {
  ViewNode,
  ViewEdge,
  NodeProvider,
  EdgeProvider,
  NodeProps,
  TopologyDataMap,
  TopologyDataObject,
  GraphModel,
  Edge,
  ViewGroup,
  GroupProvider,
  GroupProps,
  GroupElementInterface,
} from './topology-types';

const ZOOM_EXTENT: [number, number] = [0.25, 4];

interface State {
  zoomTransform?: {
    x: number;
    y: number;
    k: number;
  };
  nodesById: {
    [id: string]: ViewNode;
  };
  nodes: string[];
  edgesById: {
    [id: string]: ViewEdge;
  };
  edges: string[];
  groupsById: {
    [id: string]: ViewGroup;
  };
  groups: string[];
  graph?: GraphModel;
  dragNodeId: string;
  sourceGroup: string;
  targetGroup: string;
}

export interface D3ForceDirectedRendererProps {
  width: number;
  height: number;
  graph: GraphModel;
  topology: TopologyDataMap;
  nodeProvider: NodeProvider;
  edgeProvider: EdgeProvider;
  groupProvider: GroupProvider;
  nodeSize: number;
  selected?: string;
  onSelect?(string): void;
  onUpdateNodeGroup?(nodeId: string, targetGroup: string): Promise<any>;
}

function getEdgeId(d: Edge): string {
  return d.id || `${d.source}_${d.target}`;
}

export default class D3ForceDirectedRenderer extends React.Component<
  D3ForceDirectedRendererProps,
  State
> {
  private $svg: d3.Selection<SVGSVGElement, null, null, undefined>;

  private zoom: d3.ZoomBehavior<Element, {}>;

  private simulation: d3.Simulation<{}, undefined>;

  private zoomGroup = React.createRef<SVGGElement>();

  private dragCount: number = 0;

  private ignoreNextSizeChange: boolean = false;

  constructor(props) {
    super(props);
    this.state = {
      nodesById: {},
      nodes: [],
      edgesById: {},
      edges: [],
      groupsById: {},
      groups: [],
      dragNodeId: '',
      sourceGroup: '',
      targetGroup: '',
    };

    this.simulation = d3
      .forceSimulation()
      .force('collide', d3.forceCollide().radius(props.nodeSize))
      .force('charge', d3.forceManyBody())
      .force('center', d3.forceCenter(props.width / 2, props.height / 2));
  }

  static getDerivedStateFromProps(
    nextProps: D3ForceDirectedRendererProps,
    prevState: State,
  ): State {
    if (nextProps.graph === prevState.graph) {
      // do not re-compute state if graph has not changed
      return prevState;
    }

    const { graph, nodes, edges, groups, nodesById, edgesById, groupsById } = prevState;

    // Not the most efficient checks but ensures that if the nodes and edges are the same,
    // then we re-use the old state.
    // If nodes or edges change, re-create the state but re-use the old positions of the nodes.

    let newNodesById = nodesById;
    let newNodes = nextProps.graph.nodes.map((d) => d.id);
    if (_.isEqual(newNodes, nodes)) {
      newNodes = nodes;
    } else {
      newNodesById = nextProps.graph.nodes.reduce(
        (acc, d) => {
          acc[d.id] = {
            x: nextProps.width / 2,
            y: nextProps.height / 2,
            ...nodesById[d.id],
            id: d.id,
            type: d.type,
            size: nextProps.nodeSize,
            name: d.name,
          };
          return acc;
        },
        {} as any,
      );
    }

    let newEdgesById = edgesById;
    let newEdges = nextProps.graph.edges.map((d) => getEdgeId(d));
    if (newNodes === nodes && _.isEqual(newEdges, edges)) {
      newEdges = edges;
    } else {
      newEdgesById = nextProps.graph.edges.reduce(
        (acc, d) => {
          const id = getEdgeId(d);
          acc[id] = {
            ...edgesById[id],
            id,
            type: d.type,
            source: newNodesById[d.source],
            target: newNodesById[d.target],
          };
          return acc;
        },
        {} as any,
      );
    }

    let newGroupsById = groupsById;
    let newGroups = nextProps.graph.groups.map((d) => d.id);
    if (
      newNodes === nodes &&
      _.isEqual(newGroups, groups) &&
      _.isEqual(graph.groups, nextProps.graph.groups)
    ) {
      newGroups = groups;
    } else {
      newGroupsById = nextProps.graph.groups.reduce(
        (acc, d) => {
          acc[d.id] = {
            ...groupsById[d.id],
            id: d.id,
            type: d.type,
            nodes: d.nodes.map((nodeId) => newNodesById[nodeId]),
            name: d.name,
          };
          return acc;
        },
        {} as any,
      );
    }

    return {
      ...prevState,
      graph: nextProps.graph,
      nodesById: newNodesById,
      nodes: newNodes,
      edgesById: newEdgesById,
      edges: newEdges,
      groupsById: newGroupsById,
      groups: newGroups,
    };
  }

  componentDidMount() {
    this.zoom = d3
      .zoom()
      .scaleExtent(ZOOM_EXTENT)
      .on('zoom', this.onZoom);
    this.zoom(this.$svg);

    this.simulation
      .nodes(this.state.nodes.map((d) => this.state.nodesById[d]))
      .force(
        'link',
        d3
          .forceLink([
            ...this.state.edges.map((d) => this.state.edgesById[d]),
            ...this.createGroupLinks(),
          ])
          .id((d: ViewNode) => d.id),
      )
      .on('tick', () => this.forceUpdate())
      .restart();
  }

  componentDidUpdate(prevProps: D3ForceDirectedRendererProps, prevState: State) {
    let restart = false;
    const sizeChanged =
      prevProps.width !== this.props.width || prevProps.height !== this.props.height;

    if (!this.ignoreNextSizeChange && sizeChanged) {
      this.simulation.force('center', d3.forceCenter(this.props.width / 2, this.props.height / 2));
      restart = true;
    }

    if (this.ignoreNextSizeChange && sizeChanged) {
      this.ignoreNextSizeChange = false;
      if (this.props.selected) {
        this.makeNodeVisible(this.props.selected);
      }
    }

    if (!!this.props.selected !== !!prevProps.selected) {
      this.ignoreNextSizeChange = true;
    }

    if (
      prevState.nodes !== this.state.nodes ||
      prevState.edges !== this.state.edges ||
      prevState.groups !== this.state.groups
    ) {
      this.simulation
        .nodes(this.state.nodes.map((d) => this.state.nodesById[d]))
        .force(
          'link',
          d3
            .forceLink([
              ...this.state.edges.map((d) => this.state.edgesById[d]),
              ...this.createGroupLinks(),
            ])
            .id((d: ViewNode) => d.id),
        )
        .alpha(0.2);
      restart = true;
    }

    if (restart) {
      this.simulation.restart();
    }
  }

  componentWillUnmount() {
    this.simulation.stop();
  }

  private refSvg = (node: SVGSVGElement) => {
    this.$svg = d3.select(node);
  };

  private refGroupSvg = (groupElement: GroupElementInterface, groupId: string) => {
    const { groupsById } = this.state;
    groupsById[groupId].element = groupElement;
  };

  private onZoom = () => {
    this.setState({ zoomTransform: d3.event.transform });
  };

  private makeNodeVisible = (nodeId: string) => {
    const { width, height } = this.props;
    const { nodesById, zoomTransform = { x: 0, y: 0, k: 1 } } = this.state;
    const node: ViewNode = nodesById[nodeId];
    let moveToNode = false;
    const panOffset = 20;

    if (!node) {
      return;
    }

    const center = {
      x: (width / 2 - zoomTransform.x) / zoomTransform.k,
      y: (height / 2 - zoomTransform.y) / zoomTransform.k,
    };

    const nodeMin = {
      x: zoomTransform.x + (node.x - node.size / 2) * zoomTransform.k,
      y: zoomTransform.y + (node.y - node.size / 2) * zoomTransform.k,
    };
    const nodeMax = {
      x: zoomTransform.x + (node.x + node.size / 2) * zoomTransform.k,
      y: zoomTransform.y + (node.y + node.size / 2) * zoomTransform.k,
    };

    if (nodeMax.x < 0) {
      center.x += (nodeMin.x - panOffset) / zoomTransform.k;
      moveToNode = true;
    }
    if (nodeMin.x > width) {
      center.x += (nodeMax.x - width + panOffset) / zoomTransform.k;
      moveToNode = true;
    }
    if (nodeMax.y < 0) {
      center.y += (nodeMin.y - panOffset) / zoomTransform.k;
      moveToNode = true;
    }
    if (nodeMin.y > height) {
      center.y += (nodeMax.y - height + panOffset) / zoomTransform.k;
      moveToNode = true;
    }

    if (moveToNode) {
      this.zoom.translateTo(this.$svg, center.x, center.y);
    }
  };

  private lockNodes = () => {
    const { nodes, nodesById } = this.state;
    nodes.forEach((id) => {
      nodesById[id].fx = nodesById[id].x;
      nodesById[id].fy = nodesById[id].y;
    });
  };

  private unlockNodes = () => {
    const { nodes, nodesById } = this.state;
    nodes.forEach((id) => {
      nodesById[id].fx = null;
      nodesById[id].fy = null;
    });
  };

  private onNodeEnter = ($node: NodeSelection) => {
    $node.call(
      d3
        .drag<SVGGElement, ViewNode>()
        .on('start', () => this.onNodeDragStart())
        .on('drag', (d) => this.onNodeDragged(d))
        .on('end', (d) => this.onNodeDragEnd(d))
        .filter(() => this.state.nodes.length > 1),
    );
  };

  private onNodeDragStart = () => {
    d3.event.sourceEvent.stopPropagation();

    if (d3.event.sourceEvent.which !== 1) {
      return;
    }

    if (this.dragCount) {
      this.dragCount++;
    }
  };

  private initializeNodeDrag = (d: ViewNode) => {
    const { groups, groupsById } = this.state;

    this.lockNodes();

    const sourceGroup = _.find(groups, (id: string) => _.includes(groupsById[id].nodes, d));
    this.setState({ dragNodeId: d.id, sourceGroup, targetGroup: sourceGroup });
  };

  private onNodeDragged = (d: ViewNode) => {
    const { groups, groupsById, targetGroup } = this.state;

    if (d3.event.sourceEvent.which !== 1) {
      return;
    }

    if (!this.dragCount && (Math.abs(d.x - d3.event.x) > 5 || Math.abs(d.y - d3.event.y) > 5)) {
      this.dragCount++;
      this.simulation.alphaTarget(0.1).restart();
      this.initializeNodeDrag(d);
      return;
    }

    if (this.dragCount) {
      d.fx = d3.event.x; // Math.min(width, Math.max(0, d3.event.x));
      d.fy = d3.event.y; // Math.min(height, Math.max(0, d3.event.y));

      if (d3.event.dx === 0 && d3.event.dy === 0) {
        return;
      }
      const point: [number, number] = [d3.event.x, d3.event.y];

      const newTargetGroup = _.find(groups, (groupId) => {
        const groupElement: any = groupsById[groupId].element;
        return groupElement && groupElement.isPointInGroup(point);
      });

      if (newTargetGroup !== targetGroup) {
        this.setState({ targetGroup: newTargetGroup });
      }
    }
  };

  private onNodeDragEnd = (d: ViewNode) => {
    const { onUpdateNodeGroup } = this.props;
    const { sourceGroup, targetGroup, groupsById } = this.state;
    const targetGroupName = _.get(groupsById[targetGroup], 'name', '');

    if (d3.event.sourceEvent.which !== 1) {
      return;
    }

    if (this.dragCount) {
      --this.dragCount;
      if (!this.dragCount && !d3.event.active) {
        this.simulation.alphaTarget(0);
      }
    }

    const onComplete = () => {
      this.unlockNodes();
      this.setState({ dragNodeId: '', sourceGroup: '', targetGroup: '' });
    };

    if (sourceGroup === targetGroup || !onUpdateNodeGroup) {
      onComplete();
      return;
    }

    if (sourceGroup) {
      const title = targetGroup ? 'Move Component Node' : 'Remove Component Node from Application';
      const message = (
        <React.Fragment>
          Are you sure you want to {targetGroup ? 'move' : 'remove'} <strong>{d.name}</strong> from{' '}
          {groupsById[sourceGroup].name}
          {targetGroup ? ` to ${targetGroupName}` : ''}?
        </React.Fragment>
      );
      const btnText = targetGroup ? 'Move' : 'Remove';

      confirmModal({
        title,
        message,
        btnText,
        close: onComplete,
        executeFn: () => {
          return onUpdateNodeGroup(d.id, targetGroupName).catch((err) => {
            const error = err.message;
            errorModal({ error });
          });
        },
      });
      return;
    }

    onUpdateNodeGroup(d.id, targetGroupName)
      .then(onComplete)
      .catch((err) => {
        const error = err.message;
        errorModal({ error });
        onComplete();
      });
  };

  private onGroupEnter = ($group: GroupSelection) => {
    $group.call(
      d3
        .drag<SVGGElement, ViewGroup>()
        .on('start', (d) => this.onGroupDragStart(d))
        .on('drag', (d) => this.onGroupDragged(d))
        .on('end', (d) => this.onGroupDragEnd(d))
        .filter(
          () =>
            this.state.groups.length > 1 ||
            this.state.groupsById[this.state.groups[0]].nodes.length !== this.state.nodes.length,
        ),
    );
  };

  private onGroupDragStart = (d: ViewGroup) => {
    if (d3.event.sourceEvent.which !== 1) {
      return;
    }

    if (!d3.event.active) {
      this.simulation.alphaTarget(0.1).restart();
    }
    d.nodes.forEach((gd) => {
      gd.fx = gd.x;
      gd.fy = gd.y;
    });
  };

  private onGroupDragged = (d: ViewGroup) => {
    if (d3.event.sourceEvent.which !== 1) {
      return;
    }

    d.nodes.forEach((gd) => {
      gd.fx += d3.event.dx;
      gd.fy += d3.event.dy;
    });
  };

  private onGroupDragEnd = (d: ViewGroup) => {
    if (d3.event.sourceEvent.which !== 1) {
      return;
    }

    if (!d3.event.active) {
      this.simulation.alphaTarget(0);
    }
    d.nodes.forEach((gd) => {
      gd.fx = null;
      gd.fy = null;
    });
  };

  private deselect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (this.props.selected) {
      this.props.onSelect(null);
    }
  };

  public api() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const api = {
      zoomIn() {
        self.zoom.scaleBy(self.$svg, 4 / 3);
      },
      zoomOut() {
        self.zoom.scaleBy(self.$svg, 0.75);
      },
      zoomFit() {
        const { width: fullWidth, height: fullHeight } = self.props;
        const bounds = self.zoomGroup.current.getBBox();
        const { width, height } = bounds;
        const midX = bounds.x + width / 2;
        const midY = bounds.y + height / 2;
        if (width === 0 || height === 0) {
          return;
        }

        // set the max scale to be the current zoom level or 1 if not defined
        const maxScale = self.state.zoomTransform ? Math.max(self.state.zoomTransform.k, 1) : 1;

        // set scale such that there is a 10% padding
        const scale = Math.min(0.9 / Math.max(width / fullWidth, height / fullHeight), maxScale);

        // translate to center
        const translate = [fullWidth / 2 - midX * scale, fullHeight / 2 - midY * scale];
        const t = d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale);

        // update the min scaling value such that the user can zoom out to the new scale in case
        // it is smaller than the default zoom out scale
        self.zoom.scaleExtent([Math.min(scale, ZOOM_EXTENT[0]), ZOOM_EXTENT[1]]);

        self.zoom.transform(self.$svg, t);
      },
      zoomReset() {
        self.zoom.scaleExtent(ZOOM_EXTENT);
        self.zoom.transform(self.$svg, d3.zoomIdentity);
      },
      resetLayout() {
        const { width, height } = self.props;
        const midX = width / 2;
        const midY = height / 2;
        // reset node positions
        self.state.nodes.forEach((id) => {
          const node = self.state.nodesById[id];
          node.x = midX;
          node.y = midY;
        });
        // reset zoom
        api.zoomReset();
        // run layout
        self.simulation.alpha(1);
        self.simulation.restart();
      },
    };
    return api;
  }

  private createGroupLinks(): any[] {
    const { groups, groupsById } = this.state;
    const groupLinks = [];
    // link each node within a group together to form group clusters
    groups.forEach((g) => {
      const { nodes } = groupsById[g];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          groupLinks.push({
            source: nodes[i],
            target: nodes[j],
          });
        }
      }
    });
    return groupLinks;
  }

  private draggedEdges() {
    const { dragNodeId, edgesById } = this.state;
    if (!dragNodeId) {
      return [];
    }
    const edges = _.filter(edgesById, (viewEdge: ViewEdge) => {
      return viewEdge.source.id === dragNodeId || viewEdge.target.id === dragNodeId;
    });
    return _.map(edges, 'id');
  }

  private draggedNodes() {
    const { dragNodeId, edgesById, nodes } = this.state;
    if (!dragNodeId) {
      return [];
    }
    const edges = _.filter(edgesById, (viewEdge: ViewEdge) => {
      return viewEdge.source.id === dragNodeId || viewEdge.target.id === dragNodeId;
    });

    return _.filter(nodes, (nodeId: string) =>
      _.find(edges, (edge: ViewEdge) => edge.source.id === nodeId || edge.target.id === nodeId),
    );
  }

  renderNode(nodeId: string) {
    const { nodeProvider, selected, onSelect, topology } = this.props;
    const { nodesById, dragNodeId } = this.state;

    const data = topology[nodeId];
    const viewNode = nodesById[nodeId];
    const Component = nodeProvider(viewNode.type);
    return (
      <ViewWrapper
        component={Component}
        {...viewNode}
        view={viewNode}
        data={data}
        key={nodeId}
        selected={nodeId === selected}
        onSelect={onSelect ? () => onSelect(nodeId) : null}
        onEnter={this.onNodeEnter}
        isDragging={nodeId === dragNodeId}
      />
    );
  }

  renderEdge(edgeId: string) {
    const { topology, edgeProvider } = this.props;
    const { edgesById, dragNodeId } = this.state;

    const data = topology[edgeId];
    const viewEdge = edgesById[edgeId];
    const Component = edgeProvider(viewEdge.type);
    return (
      <Component
        {...viewEdge}
        key={edgeId}
        data={data}
        isDragging={viewEdge.source.id === dragNodeId || viewEdge.target.id === dragNodeId}
      />
    );
  }

  renderDragItems(edges, nodes) {
    return (
      <React.Fragment>
        {_.map(edges, (edgeId) => this.renderEdge(edgeId))}
        {_.map(nodes, (nodeId) => this.renderNode(nodeId))}
      </React.Fragment>
    );
  }

  render() {
    const { width, height, groupProvider } = this.props;
    const {
      nodes,
      edges,
      groups,
      groupsById,
      zoomTransform,
      dragNodeId,
      sourceGroup,
      targetGroup,
    } = this.state;
    const draggedEdges = this.draggedEdges();
    const draggedNodes = this.draggedNodes();
    return (
      <svg
        height={height}
        width={width}
        ref={this.refSvg}
        onClick={this.deselect}
        className={dragNodeId ? 'odc-m-drag-active' : ''}
      >
        <SvgDefsProvider>
          <g transform={zoomTransform && zoomTransform.toString()} ref={this.zoomGroup}>
            <g>
              {groups.map((groupId) => {
                const viewGroup = groupsById[groupId];
                const Component = groupProvider(viewGroup.type);

                return (
                  <GroupWrapper
                    component={Component}
                    {...viewGroup}
                    key={groupId}
                    onEnter={this.onGroupEnter}
                    view={viewGroup}
                    dropSource={groupId === sourceGroup}
                    dropTarget={groupId === targetGroup}
                    groupRef={(ref: GroupElementInterface) => this.refGroupSvg(ref, groupId)}
                  />
                );
              })}
            </g>
            <g>
              {edges.map((edgeId) =>
                _.includes(draggedEdges, edgeId) ? null : this.renderEdge(edgeId),
              )}
            </g>
            <g>
              {nodes.map((nodeId) =>
                _.includes(draggedNodes, nodeId) ? null : this.renderNode(nodeId),
              )}
              {dragNodeId && this.renderDragItems(draggedEdges, draggedNodes)}
            </g>
          </g>
        </SvgDefsProvider>
      </svg>
    );
  }
}

type NodeSelection = d3.Selection<Element, ViewNode, null, undefined>;

type ViewWrapperProps = NodeProps & {
  component: React.ComponentType<NodeProps>;
  onEnter(NodeSelection): void;
  view: ViewNode;
  data: TopologyDataObject;
  isDragging?: boolean;
};

class ViewWrapper extends React.Component<ViewWrapperProps> {
  private $node: NodeSelection;

  componentDidMount() {
    // eslint-disable-next-line react/no-find-dom-node
    this.$node = d3.select(ReactDOM.findDOMNode(this) as Element).datum(this.props.view);
    this.props.onEnter && this.props.onEnter(this.$node);
  }

  componentDidUpdate(prevProps: ViewWrapperProps) {
    if (prevProps.view !== this.props.view) {
      // we need to update the data so that d3 apis get the correct new node
      this.$node.datum(this.props.view);
    }
  }

  render() {
    const { component: Component, onEnter, view, ...other } = this.props;
    return <Component {...other} />;
  }
}

type GroupSelection = d3.Selection<Element, ViewGroup, null, undefined>;

type GroupWrapperProps = GroupProps & {
  component: React.ComponentType<GroupProps>;
  onEnter(GroupSelection): void;
  view: ViewGroup;
};

class GroupWrapper extends React.Component<GroupWrapperProps> {
  private $group: GroupSelection;

  componentDidMount() {
    // eslint-disable-next-line react/no-find-dom-node
    this.$group = d3.select(ReactDOM.findDOMNode(this) as Element).datum(this.props.view);
    this.props.onEnter && this.props.onEnter(this.$group);
  }

  componentDidUpdate(prevProps: GroupWrapperProps) {
    if (prevProps.view !== this.props.view) {
      // we need to update the data so that d3 apis get the correct new group
      this.$group.datum(this.props.view);
    }
  }

  render() {
    const { component: Component, onEnter, view, ...other } = this.props;
    return <Component {...other} />;
  }
}
