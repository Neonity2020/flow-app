import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "../components/Workspace";
export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectPage,
  ssr: false,
});
function ProjectPage() {
  const { projectId } = Route.useParams();
  return <Workspace key={projectId} projectId={projectId} />;
}
