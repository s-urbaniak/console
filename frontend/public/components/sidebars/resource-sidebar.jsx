import * as React from 'react';
import {
  CloseIcon,
  DownloadIcon,
  InfoCircleIcon,
  PasteIcon,
} from '@patternfly/react-icons';

import { resourceSidebars } from './resource-sidebars';

export const sidebarScrollTop = () => {
  document.getElementsByClassName('co-p-has-sidebar__sidebar')[0].scrollTop = 0;
};

export class ResourceSidebarWrapper extends React.Component {
  constructor(props) {
    super(props);
    this.toggleSidebar = this.toggleSidebar.bind(this);
    this.state = {
      showSidebar: !props.startHidden,
    };
  }

  toggleSidebar() {
    this.setState(state => {
      return {showSidebar: !state.showSidebar};
    }, () => window.dispatchEvent(new Event('sidebar_toggle')));
  }

  render() {
    const {style, label, linkLabel, children} = this.props;
    const {height} = style;
    const {showSidebar} = this.state;

    if (!showSidebar) {
      return <div className="co-p-has-sidebar__sidebar--hidden hidden-sm hidden-xs">
        <button className="btn btn-link" onClick={this.toggleSidebar}>
          <InfoCircleIcon className="co-icon-space-r co-p-has-sidebar__sidebar-link-icon" />{linkLabel}
        </button>
      </div>;
    }

    return <div className="co-p-has-sidebar__sidebar co-p-has-sidebar__sidebar--bordered hidden-sm hidden-xs" style={{height}}>
      <div className="co-m-pane__body">
        <button type="button" className="close" aria-label="Close" onClick={this.toggleSidebar}>
          <CloseIcon />
        </button>
        <h1 className="co-p-has-sidebar__sidebar-heading co-resource-sidebar-header text-capitalize">
          {label}
        </h1>
        {children}
      </div>
    </div>;
  }
}

export const SampleYaml = ({sample, loadSampleYaml, downloadSampleYaml}) => {
  const {highlightText, header, subheader, img, details, templateName, kind} = sample;
  return <li className="co-resource-sidebar-item">
    <h5 className="co-resource-sidebar-item__header">
      <span className="text-uppercase">{highlightText}</span> {header} <span className="co-role-sidebar-subheader">{subheader}</span>
    </h5>
    {img && <img src={img} className="co-resource-sidebar-item__img" />}
    <p className="co-resource-sidebar-item__details">
      {details}
    </p>
    <button className="btn btn-link" onClick={() => loadSampleYaml(templateName, kind)}>
      <PasteIcon className="co-icon-space-r" />Try it
    </button>
    <button className="btn btn-link pull-right" onClick={() => downloadSampleYaml(templateName, kind)}>
      <DownloadIcon className="co-icon-space-r" />Download YAML
    </button>
  </li>;
};

export const ResourceSidebar = props => {
  const {kindObj, height} = props;
  if (!kindObj || !props.isCreateMode) {
    return null;
  }

  const {kind, label} = kindObj;
  const SidebarComponent = resourceSidebars.get(kind);
  if (SidebarComponent) {
    return <ResourceSidebarWrapper label={`${label} Samples`} linkLabel="View Samples" style={{height}}>
      <SidebarComponent {...props} />
    </ResourceSidebarWrapper>;
  }
  return null;
};
