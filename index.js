'use strict';

const Promise = require('bluebird');
const phantom = require('phantom');
const sleep = require('sleep-promise');
const moment = require('moment');
const aws = require('aws-sdk');
const SATURDAY = 6;
const SUNDAY = 1;

module.exports.handler = (event, context, callback) => {
    return Promise.coroutine(processEvent)(event, context, callback);
}

function *processEvent(event, context, callback) {
    console.log('lambda is started');
    // to quit finally
    let instance;

    Promise.coroutine(function* () {
        instance = yield phantom.create();
        const page = yield instance.createPage();

        let status = yield page.open('https://calendar.google.com/calendar/embed?src=vf934677bpu4a8pa6gprn1sis8%40group.calendar.google.com&ctz=Asia%2FTokyo');
        console.log(status);
        if (status != 'success') {
            throw new Error('page is not opend');
        }

        /*** page.evaluate return element data to nodejs scope ***/
        const title = yield page.evaluate(function() {
            return document.title;
        });
        console.log(title);

        // wait for calendar loading complete
        yield sleep(3000);

        // 今年の経過週から当月最初の経過数を減算することで求まる
        const pastWeekInYear = moment().week();
        let weekInThisMonth = pastWeekInYear - moment().startOf('month').week() + 1;

        console.log('nth week:', weekInThisMonth);

        let avalable = {
            'onSat': false,
            'onSun': false
        };

        avalable.OnSat = yield page.evaluate(function(s) {
            return !document.querySelector(s).childElementCount;
        }, `#mvEventContainer2 > div:nth-child(${weekInThisMonth}) > table.st-grid > tbody > tr:nth-child(2) > td:nth-child(${SATURDAY})`);
        console.log('avalable.onSat:', avalable.onSat);

        // 最終週の金曜の場合カレンダーをめくり、一週目をみる
        if (pastWeekInYear == moment().endOf('month').week()) {
            yield page.evaluate(function() {
                return document.querySelector('#navForward1').click();
            });
            weekInThisMonth = 1;
        }
        avalable.onSun = yield page.evaluate(function(s) {
            return !document.querySelector(s).childElementCount;
        }, `#mvEventContainer2 > div:nth-child(${weekInThisMonth}) > table.st-grid > tbody > tr:nth-child(2) > td:nth-child(${SUNDAY})`);
        console.log('avalable.onSun:', avalable.onSun);

        let message = {
            "channel": process.env.SLACK_CHANNEL,
            "emoji": process.env.SLACK_EMOJI,
            "username": "lambda-itbp-crit-schedule-watcher",
            "attachments": [
                {
                    "color": "",
                    "pretext": "今週はあのスペースが...",
                    "title": "ITビジネスプラザ武蔵サロンスペースイベント情報",
                    "title_link": "https://calendar.google.com/calendar/embed?src=vf934677bpu4a8pa6gprn1sis8%40group.calendar.google.com&ctz=Asia%2FTokyo",
                    "text": "Optional text that appears within the attachment",
                    "fields": [
                        {
                            "title": "Saturday",
                            "value": avalable.onSat ? "予約あり" : "空き",
                            "short": true
                        },
        				{
                            "title": "Sunday",
                            "value": avalable.onSun ? "予約あり" : "空き",
                            "short": true
                        }
                    ],
                    "footer": "lambda-itbp-crit-schedule-watcher",
                    "footer_icon": "https://platform.slack-edge.com/img/default_application_icon.png"
                }
            ]
        }

        if (avalable.onSat && avalable.onSun) {
            message.attachments[0].color = 'good';
        } else if (avalable.onSat || avalable.onSun) {
            message.attachments[0].color = 'warning';
        } else {
            message.attachments[0].color = 'danger';
        }

        var awParam = {
            FunctionName: "notify-slack",
            InvokeArgs: JSON.stringify(message)
        };
        lambda.invokeAsync(awParam, function(err, data) {
            if(err) {
                console.log('invoke notify-slack is fail');
                throw err;
            }
        });

        console.log(JSON.stringify(message));


    })().then(() => {
        console.log('lambda will ended with success');
        callback(null, 'done success');
    }).catch((err) => {
        console.error(err.stack);
        console.log('lambda will ended with failure');
        callback('done failure');
    }).finally(() => {
        console.log('finally is started');
        Promise.coroutine(function *() {
            yield instance.exit();
        })().then(() => {
            console.log('lambda is closed');
        });
    });
};
