import   $                          from 'jquery';
import {LoggerFactory}            from '../fe-core/logger/LoggerFactory';
import {ContextHelper}              from '../fe-core/utils/ContextHelper';
import {Access}                     from '../env/Access';
import {HTTPUtils}                  from '../utils/HTTPUtils';
import {Config}                     from '../env/Config';
import {DocumentManager}            from '../document/DocumentManager'

let singleton         = Symbol();
let singletonEnforcer = Symbol();

const logger = LoggerFactory.getLogger( 'CommandPushQueue' );
/**
 *
 * @author duzhaoxuan
 * @version 1.0.0
 * */

export class CommandPusherQueue {

    constructor( enforcer ) {
        if ( enforcer != singletonEnforcer ) {
            let msg = '[constructor] Cannot instantiate singleton with constructor.';
            logger.error( msg );
            throw new Error( msg );
        }
        this._commandsGroup = [];
        this._commandsQueue = [];
        this._reloadTime    = 0;

        //状态堆栈发送状态
        //0:初始化状态,没有进行中的后台请求,当前可发送请求;
        //1:开始发送请求;
        //2:请求失败；
        this._netState = 0;
    }

    static get instance() {
        if ( !this[ singleton ] ) {
            this[ singleton ] = new CommandPusherQueue( singletonEnforcer );
        }
        return this[ singleton ];
    }

    canPreview() {
        return CommandPusherQueue.instance._commandsGroup.length === 0
               && CommandPusherQueue.instance._commandsQueue.length === 0;
    }

    organize( command, id, key, value ) {
        return new Promise( ContextHelper.delegate( function ( resolve, reject ) {

            // Push the command.
            let isPush = this._isPush( command, id, key, value );
            if ( isPush ) {
                this._commandsGroup.push( { command, params: { id, key, value } } );
            }

            if ( this._timeout ) {
                if ( this._commandsGroup.length >= 20 ) {
                    let msg = '[CommandPusherQueue] commandsGroup number more than limit, forced to push.';
                    logger.warn( msg );
                    this._pushQueue( this._commandsGroup );
                    this._commandsGroup = [];
                }
                clearTimeout( this._timeout );
            }

            this._timeout = setTimeout( ContextHelper.delegate( function () {
                this._pushQueue( this._commandsGroup );
                this._commandsGroup = [];
            }, this ), Config.pusher.delay );

        }, this ) );
    }

    _isPush( command, id, key, value ) {
        let isPush = true;
        this._commandsGroup.forEach( function ( c ) {
            if ( c.params.key === key && c.command === command && c.params.id === id && c.command
                                                                                        === "urdata" ) {
                c.params.value = value;
                isPush         = false;
            }
        }, this );
        return isPush;
    }

    _pushQueue( commands ) {
        if ( commands.length > 0 ) {
            this._commandsQueue.push( commands );
            this._check();
        }
    }

    _check() {
        if ( this._netState === 0 ) {
            if ( this._commandsQueue.length > 0 ) {
                let sendCommands = this._commandsQueue.slice( 0, 1 );
                this._netState   = 1;
                if ( sendCommands[ 0 ][ 0 ].command === "savedoc" || sendCommands[ 0 ][ 0 ].command
                                                                     === "publishdoc" ) {
                    this._hungUp( sendCommands );
                }
                this._send( sendCommands );
            }
        }
    }

    _send( sendCommands ) {
        HTTPUtils.post( Access.Command.send.url, sendCommands[ 0 ], 'json' )
                 .then( ContextHelper.delegate( function ( res ) {
                     if ( sendCommands[ 0 ][ 0 ].command === "urwhole"
                          | sendCommands[ 0 ][ 0 ].command === "savedoc"
                          | sendCommands[ 0 ][ 0 ].command === "publishdoc" ) {
                         this._hungDown();
                     }
                     //初始化重新加载次数
                     this._reloadTime = 0;
                     //初始化连接状态
                     this._netState   = 0;
                     //处理成功后
                     this._message( res );
                     this._commandsQueue.splice( 0, 1 );
                     this._check();
                 }, this ) )
                 .catch( ContextHelper.delegate( function ( res ) {
                     if ( sendCommands[ 0 ][ 0 ].command === "urwhole"
                          | sendCommands[ 0 ][ 0 ].command === "savedoc"
                          | sendCommands[ 0 ][ 0 ].command === "publishdoc" ) {
                         this._reload( sendCommands );
                     } else {
                         this.clear();
                         this._netState  = 0;
                         let command     = DocumentManager.instance.assembleRenderingInfo();
                         command.command = "urwhole";
                         this._pushQueue( [ command ] );
                     }
                 }, this ) )
    }

    _reload( commands ) {
        if ( this._reloadTime < 3 ) {
            // 发全量数据
            this._hungUp( commands );
            setTimeout( ContextHelper.delegate( function () {
                this._send( commands );
            }, this ), 5000 );
            this._reloadTime++;
        } else {
            //显示刷新按钮
            this._hungUp();
        }
    }

    clear() {
        this._commandsGroup = [];
        this._commandsQueue = [];
    }

    _message( res ) {
        let date = new Date();
        let y    = date.getFullYear();
        let M    = date.getMonth() + 1;
        let d    = date.getDate();
        let h    = date.getHours();
        let m    = date.getMinutes();
        let s    = date.getSeconds();
        let reg  = /^[0-9]$/;
        if ( reg.test( s ) ) {
            s = "0" + s;
        }
        if ( reg.test( m ) ) {
            m = "0" + m;
        }
        if ( reg.test( h ) ) {
            h = "0" + h;
        }
        if ( res.status == 200 ) {
            if ( $( "#rightSlideBar" ).hasClass( "z-slide-show" ) ) {
                $( "#rightSlideBar" ).removeClass( "z-slide-show" )
            }

            switch ( this._commandsQueue[ 0 ][ 0 ].command ) {
                case 'savedoc':
                    $( "#messageDialog" ).css( "color", "#00b050" ).html(
                        y + "-" + M + "-" + d + " " + h + ":" + m + ":" + s + " 保存成功！" ).fadeIn();
                    break;
                case 'publishdoc':
                    $( "#messageDialog" ).css( "color", "#00b050" ).html(
                        y + "-" + M + "-" + d + " " + h + ":" + m + ":" + s + " 发布成功！" ).fadeIn();
                    break;
                default :
                    $( "#messageDialog" ).css( "color", "#00b050" ).html(
                        y + "-" + M + "-" + d + " " + h + ":" + m + ":" + s + " 自动保存成功！" ).fadeIn();
            }


        } else if ( res.status == 401 ) {
            $( "#messageDialog" ).css( "color", "#ff0000" ).html( "您的登陆已失效，3秒后将进入登陆页！" ).fadeIn();
            setTimeout( function () {
                window.location.replace( Config.noppt + "user/login" );
            }, 3000 )
        } else if ( res.status == 412 ) {
            this.message( {
                text : "这个不是您的作品！3秒后将进行调转！",
                color: "#ff0000"
            } );
            setTimeout( function () {
                window.location.replace( Config.noppt + "mine/bright/document" );
            }, 3000 )
        }
        else {
            $( "#messageDialog" ).css( "color", "#ff0000" ).html(
                y + "-" + M + "-" + d + " " + h + ":" + m + ":" + s + " 自动保存失败！" ).fadeIn();
        }
    }

    _hungUp( sendCommands ) {
        if ( this._reloadTime > 2 ) {
            $( '.loader--circularSquare' ).css( 'display', 'none' );
            $( '.cover-refresh' ).css( 'display', 'block' );
            $( '.cover-cue' ).css( 'display', 'block' ).html( '抱歉，您与服务器已断开链接，请刷新重试。' );
        } else {
            switch ( sendCommands[ 0 ][ 0 ].command ) {
                case 'urwhole':
                    $( '.cover-cue' ).html( '第 ' + (this._reloadTime + 1) + ' 次尝试重新链接服务器...' );
                    break;
                case 'savedoc':
                    $( '.cover-cue' ).html( '正在保存数据...' );
                    break;
                case 'publishdoc':
                    $( '.cover-cue' ).html( '正在保存并发布数据...' );
                    break;
            }

            $( '.cover-cue' ).css( 'display', 'block' );
            $( '.loader--circularSquare' ).css( 'display', 'block' );
            $( '.cover-refresh' ).css( 'display', 'none' );
        }
        $( '.m-cover' ).addClass( 'z-act' );

    }

    _hungDown() {
        $( '.m-cover' ).removeClass( 'z-act' );
    }
}
