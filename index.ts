import events = require('aws-cdk-lib/aws-events');
import targets = require('aws-cdk-lib/aws-events-targets');
import lambda = require('aws-cdk-lib/aws-lambda');
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import cdk = require('aws-cdk-lib');
require('dotenv').config()
import { env } from 'process'

const appName = 'SmashEventRss'
const lambdaName = appName + 'Lamba'

export class EventBridgeLambdaStack extends cdk.Stack {
  constructor(app: cdk.App, id: string) {
    super(app, id);

    const source = codebuild.Source.gitHub({
      owner: 'tasasei',
      repo: 'eveco-rss-lambda',
      webhook: true,
      webhookFilters: [
        codebuild.FilterGroup
          .inEventOf(codebuild.EventAction.PUSH)
          .andBranchIs('main'),
      ],
    })
    const bucket = new s3.Bucket(this, 'MyBuildBucket');
    const buildProjectName = lambdaName + 'BuildProject'
    const project = new codebuild.Project(this, buildProjectName, {
      source: source,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
      artifacts: codebuild.Artifacts.s3({
        includeBuildId: false,
        packageZip: true,
        path: buildProjectName,
        name: 'lambda.zip',
        bucket: bucket,
      })
    })

    // add write
    bucket.grantWrite(project)

    // Lambda outputs to this loggroup
    const logGroup = new logs.LogGroup(this, lambdaName + 'LogGroup', {
      logGroupName: `/aws/lambda/${lambdaName}Stack-${lambdaName}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Lambda Function to publish message to SNS
    const lambdaFn = new lambda.Function(this, lambdaName, {
      code: lambda.S3CodeV2.fromBucketV2(bucket, `${buildProjectName}/lambda.zip`),
      handler: 'dist/index.handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      logGroup,
    });

    // Allow Write
    logGroup.grantWrite(lambdaFn)

    // Run the eventbridge every minute
    const rule = new events.Rule(this, `${lambdaName}Rule`, {
      schedule: events.Schedule.expression('rate(6 hours)')
    });

    // Add the lambda function as a target to the eventbridge
    rule.addTarget(new targets.LambdaFunction(lambdaFn, {
      event: events.RuleTargetInput.fromObject({
        bluesky_id: env.BLUSEKY_ID || '',
        bluesky_pw: env.BLUSEKY_PW || '',
        rss_url: env.RSS_URL || '',
      }),
    }));

    // Add the permission to the lambda function to publish to SNS
    // const snsTopicPolicy = new iam.PolicyStatement({
    //   actions: ['sns:publish'],
    //   resources: ['*'],
    // });

    // Add the permission to the lambda function to publish to SNS
    // lambdaFn.addToRolePolicy(snsTopicPolicy);
  }
}

const app = new cdk.App();
new EventBridgeLambdaStack(app, `${lambdaName}Stack`);
app.synth();