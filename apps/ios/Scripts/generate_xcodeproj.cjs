#!/usr/bin/env node
/** Regenerate ArrabStudio.xcodeproj after adding/removing Swift sources. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "ArrabStudio");
const PROJ = path.join(ROOT, "ArrabStudio.xcodeproj");
const uid = () => crypto.randomBytes(12).toString("hex").toUpperCase();

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "Assets.xcassets") out.push(p);
      else walk(p, out);
    } else if (name.endsWith(".swift")) out.push(p);
  }
  return out;
}

const sources = walk(SRC).sort();
const ids = {
  project: uid(),
  target: uid(),
  sourcesPhase: uid(),
  resourcesPhase: uid(),
  frameworksPhase: uid(),
  productRef: uid(),
  mainGroup: uid(),
  productsGroup: uid(),
  srcGroup: uid(),
  configGroup: uid(),
  projectConfigList: uid(),
  targetConfigList: uid(),
  debugProj: uid(),
  releaseProj: uid(),
  debugTgt: uid(),
  releaseTgt: uid(),
  infoRef: uid(),
  privacyRef: uid(),
  privacyBuild: uid(),
  entitlementsRef: uid(),
};

const entries = sources.map((p) => ({ path: p, fileRef: uid(), buildFile: uid() }));
const fileRefLines = [];
const buildFileLines = [];
const sourceBuild = [];
const resourceBuild = [];

for (const e of entries) {
  const rel = path.relative(ROOT, e.path).split(path.sep).join("/");
  const name = path.basename(e.path);
  if (name.endsWith(".swift")) {
    fileRefLines.push(
      `\t\t${e.fileRef} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "${rel}"; sourceTree = SOURCE_ROOT; };`,
    );
    buildFileLines.push(
      `\t\t${e.buildFile} /* ${name} in Sources */ = {isa = PBXBuildFile; fileRef = ${e.fileRef} /* ${name} */; };`,
    );
    sourceBuild.push(`\t\t\t\t${e.buildFile} /* ${name} in Sources */,`);
  } else {
    fileRefLines.push(
      `\t\t${e.fileRef} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = "${rel}"; sourceTree = SOURCE_ROOT; };`,
    );
    buildFileLines.push(
      `\t\t${e.buildFile} /* ${name} in Resources */ = {isa = PBXBuildFile; fileRef = ${e.fileRef} /* ${name} */; };`,
    );
    resourceBuild.push(`\t\t\t\t${e.buildFile} /* ${name} in Resources */,`);
  }
}

fileRefLines.push(
  `\t\t${ids.infoRef} /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Config/Info.plist; sourceTree = SOURCE_ROOT; };`,
);
fileRefLines.push(
  `\t\t${ids.privacyRef} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Config/PrivacyInfo.xcprivacy; sourceTree = SOURCE_ROOT; };`,
);
fileRefLines.push(
  `\t\t${ids.entitlementsRef} /* ArrabStudio.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = Config/ArrabStudio.entitlements; sourceTree = SOURCE_ROOT; };`,
);
fileRefLines.push(
  `\t\t${ids.productRef} /* ArrabStudio.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ArrabStudio.app; sourceTree = BUILT_PRODUCTS_DIR; };`,
);
buildFileLines.push(
  `\t\t${ids.privacyBuild} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${ids.privacyRef} /* PrivacyInfo.xcprivacy */; };`,
);
resourceBuild.push(`\t\t\t\t${ids.privacyBuild} /* PrivacyInfo.xcprivacy in Resources */,`);
const childRefs = entries
  .map((e) => `\t\t\t\t${e.fileRef} /* ${path.basename(e.path)} */,`)
  .join("\n");

const tgtSettings = (cfg) => `
		${cfg} /* ${cfg === ids.debugTgt ? "Debug" : "Release"} */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_ENTITLEMENTS = Config/ArrabStudio.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = Config/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0.0;
				PRODUCT_BUNDLE_IDENTIFIER = studio.arrab.ios;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			};
			name = ${cfg === ids.debugTgt ? "Debug" : "Release"};
		};`;

const pbx = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 56;
	objects = {

/* Begin PBXBuildFile section */
${buildFileLines.join("\n")}
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
${fileRefLines.join("\n")}
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		${ids.frameworksPhase} /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		${ids.mainGroup} = {
			isa = PBXGroup;
			children = (
				${ids.srcGroup} /* ArrabStudio */,
				${ids.configGroup} /* Config */,
				${ids.productsGroup} /* Products */,
			);
			sourceTree = "<group>";
		};
		${ids.srcGroup} /* ArrabStudio */ = {
			isa = PBXGroup;
			children = (
${childRefs}
			);
			name = ArrabStudio;
			sourceTree = "<group>";
		};
		${ids.configGroup} /* Config */ = {
			isa = PBXGroup;
			children = (
				${ids.infoRef} /* Info.plist */,
				${ids.privacyRef} /* PrivacyInfo.xcprivacy */,
				${ids.entitlementsRef} /* ArrabStudio.entitlements */,
			);
			name = Config;
			sourceTree = "<group>";
		};
		${ids.productsGroup} /* Products */ = {
			isa = PBXGroup;
			children = (
				${ids.productRef} /* ArrabStudio.app */,
			);
			name = Products;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		${ids.target} /* ArrabStudio */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = ${ids.targetConfigList} /* Build configuration list for PBXNativeTarget "ArrabStudio" */;
			buildPhases = (
				${ids.sourcesPhase} /* Sources */,
				${ids.frameworksPhase} /* Frameworks */,
				${ids.resourcesPhase} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = ArrabStudio;
			productName = ArrabStudio;
			productReference = ${ids.productRef} /* ArrabStudio.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		${ids.project} /* Project object */ = {
			isa = PBXProject;
			attributes = {
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1600;
				LastUpgradeCheck = 1600;
			};
			buildConfigurationList = ${ids.projectConfigList} /* Build configuration list for PBXProject "ArrabStudio" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
				ar,
			);
			mainGroup = ${ids.mainGroup};
			productRefGroup = ${ids.productsGroup} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				${ids.target} /* ArrabStudio */,
			);
		};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		${ids.resourcesPhase} /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
${resourceBuild.join("\n")}
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		${ids.sourcesPhase} /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
${sourceBuild.join("\n")}
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		${ids.debugProj} /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
			};
			name = Debug;
		};
		${ids.releaseProj} /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				VALIDATE_PRODUCT = YES;
			};
			name = Release;
		};
${tgtSettings(ids.debugTgt)}
${tgtSettings(ids.releaseTgt)}
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		${ids.projectConfigList} /* Build configuration list for PBXProject "ArrabStudio" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				${ids.debugProj} /* Debug */,
				${ids.releaseProj} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		${ids.targetConfigList} /* Build configuration list for PBXNativeTarget "ArrabStudio" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				${ids.debugTgt} /* Debug */,
				${ids.releaseTgt} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
/* End XCConfigurationList section */
	};
	rootObject = ${ids.project} /* Project object */;
}
`;

fs.mkdirSync(path.join(PROJ, "project.xcworkspace"), { recursive: true });
fs.mkdirSync(path.join(PROJ, "xcshareddata", "xcschemes"), { recursive: true });
fs.writeFileSync(path.join(PROJ, "project.pbxproj"), pbx);
fs.writeFileSync(
  path.join(PROJ, "project.xcworkspace", "contents.xcworkspacedata"),
  `<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "self:">
   </FileRef>
</Workspace>
`,
);

const scheme = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1600"
   version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "${ids.target}" BuildableName = "ArrabStudio.app" BlueprintName = "ArrabStudio" ReferencedContainer = "container:ArrabStudio.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "${ids.target}" BuildableName = "ArrabStudio.app" BlueprintName = "ArrabStudio" ReferencedContainer = "container:ArrabStudio.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "${ids.target}" BuildableName = "ArrabStudio.app" BlueprintName = "ArrabStudio" ReferencedContainer = "container:ArrabStudio.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
`;
fs.writeFileSync(path.join(PROJ, "xcshareddata", "xcschemes", "ArrabStudio.xcscheme"), scheme);
console.log(`Wrote ${PROJ} (${sources.length} items). Target id: ${ids.target}`);
