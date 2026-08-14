import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const webVolume = volume("web-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "ams", sizeMB: 500 });
  const web = service("web", {
    source: github("shino0415/TaskSupport"),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "ams": 1 },
    deploy: { sleepApplication: true },
    volumeMounts: {
      "/app/data": webVolume,
    },
    env: {
      API_KEY: preserve(),
      CORS_ALLOW_ORIGINS: preserve(),
      DEMO_AUTO_RESET_ENABLED: preserve(),
      RAILWAY_DOCKERFILE_PATH: preserve(),
    },
  });

  return project("tasksupport-demo", {
    resources: [web, webVolume],
  });
});
