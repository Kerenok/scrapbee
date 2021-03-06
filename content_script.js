/*
  ====================
  content_script.js
  ====================
*/
if(!window.scrapbee_injected){
    window.scrapbee_injected = true;
    function stringifyArgs(args){
        var ar = Array.from(args); 
        ar.forEach(function(v, i){
            try{
                if(typeof v != "string")
    	            v = JSON.stringify(v);
            }catch(e){
                v = String(v);
            }
            ar[i] = v;
        });
        return ar.join(', ')
    }
    var log = {
        info: function(){
            log.sendLog("info", stringifyArgs(arguments))
        },
        error: function(){
            log.sendLog("error", stringifyArgs(arguments))
        },
        warning: function(){
            log.sendLog("warning", stringifyArgs(arguments))
        },
        debug: function(){
            // log.sendLog("debug", stringifyArgs(arguments))
        },
        clear: function(){
            browser.runtime.sendMessage({type:'CLEAR_LOG'});
        },
        sendLog: function(type, content){
            browser.runtime.sendMessage({type:'LOG', logtype: type, content});
        }
    }
    var dlgDownload;
    /* clone parent and all of the ancestors to root, return parent */
    function cloneParents(p){
        var pp, cc;
        // ... -> HTMLHtmlElement(html) -> HTMLDocument -> null
        while(p){
            if(p.nodeType == 1){
                var t = p.cloneNode(false);
                if(!cc) cc = t;
                if(pp)t.appendChild(pp);
                pp = t;
                if(p.tagName.toLowerCase() == "html")
                    break;
            }
            p = p.parentNode;
        }
        return cc;
    }
    var oldLockListener;
    function lockListener(event){
        event.preventDefault();
        event.returnValue = '';
    }
    function lock(){
        if(!oldLockListener){
            window.addEventListener("beforeunload", lockListener);
            oldLockListener = lockListener;
            return true;
        } 
    }
    function unlock(){
        window.removeEventListener("beforeunload", oldLockListener);
        oldLockListener = null;
    }
    function notifyMe(msg) {
        function Next(){
            var notification = new Notification(msg, {tag:"scrapbee-tag"});
            notification.onshow = function () {
                setTimeout(notification.close.bind(notification), 5000);
            }
        }
        if (!("Notification" in window)) {
            //
        } else if (Notification.permission === "granted") {
            Next();
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission(function (permission) {
                if (permission === "granted") {
                    Next();
                }
            });
        }
    }
    function truncate(fullStr, strLen, separator) {
        if (fullStr.length <= strLen) return fullStr;
        separator = separator || '...';
        var sepLen = separator.length,
            charsToShow = strLen - sepLen,
            frontChars = Math.ceil(charsToShow/2),
            backChars = Math.floor(charsToShow/2);
        return fullStr.substr(0, frontChars) + 
            separator + 
            fullStr.substr(fullStr.length - backChars);
    };
    /* capture content */
    function getContent(sele){
        return new Promise((resolve, reject) => {
            /** html */
            var content = null;
            var div = document.createElement("div");
            if(sele){
                var selection = window.getSelection();
                if(selection.rangeCount > 0){
                    var range = window.getSelection().getRangeAt(0);
                    parentEl = range.commonAncestorContainer;
                    var p = cloneParents(parentEl);
                    var c = range.cloneContents();
                    if(p){
                        div.appendChild(p.getRootNode());
                        p.appendChild(c);
                    }else{
                        div.appendChild(c);
                    }
                    var html = div.firstChild;
                    if(html && html.tagName.toLowerCase() == "html"){
                        var heads = document.getElementsByTagName("head");
                        if(heads.length){
                            html.insertBefore(heads[0].cloneNode(true), html.firstChild);
                        }
                    }
                }else{
                    reject("no selection activated")
                }
            }else{
                div.appendChild(document.documentElement.cloneNode(true));
            }
            var __dlg = div.querySelector(".scrapbee-dlg-container")
            if(__dlg) __dlg.remove();
            /** css */
            var css=[]
            for(let sheet of document.styleSheets){
                try{
                    var rule = sheet.rules || sheet.cssRules;
                    for (let r of rule){
                        css.push(r.cssText + "");
                    }
                }catch(e){
                    if(e.name == "SecurityError") {
                        try{
                            var request = new XMLHttpRequest();
                            request.open('GET', sheet.href, false);  // `false` makes the request synchronous
                            request.send(null);
                            if (request.status === 200) {
                                css.push(request.responseText);
                            }
                        }catch(e){
                            log.error(`error process css ${sheet.href}: ${e.message}`);
                        }
                    }
                }
            }
            /** resources */
            var res = [];
            var distinct = {}
            div.childNodes.iterateAll(function(item){
                if(item.nodeType == 1){
                    var el = new ScrapbeeElement(item).processResources();
                    for(let r of el){
                        if(!distinct[r.url]){
                            distinct[r.url] = 1;
                            res.push(r);
                        }
                    }
                }
            });
            if(!res.find(item => {return item.type == "image" && item.filename == "favicon.ico"})){
                res.push({type:"image", "url": location.origin + "/favicon.ico", filename:"favicon.ico"});
            }
            /*** add main css tag */
            var mc = document.createElement("link")
            mc.rel="stylesheet";
            mc.href="index.css";
            mc.media="screen";
            var head = div.getElementsByTagName("head");
            if(head.length){
                head[0].appendChild(mc);
            }
            /*** download resources and callback */
            var result = {html: div.innerHTML.trim(), res:res, css: css.join("\n"), title: document.title};
            var downloaded = 0;
            function end(){
                dlgDownload.addRow("CSS", "index.css", "index.css", "<font style='color:#cc5500'>buffered</font>")
                dlgDownload.addRow("HTML", "index.html", "index.html", "<font style='color:#cc5500'>buffered</font>")
                resolve(result)
            }
            if(res.length){
                res.forEach(function(r, i){
                    dlgDownload.addRow("", truncate(r.url, 32), "", "<font style='color:#cc5500'>downloading..</font>")
                    downloadFile(r.url, function(b){
                        var ext = getMainMimeExt(b.type) || "";
                        r.saveas = r.filename || (r.hex+ext)
                        if(b) r.blob = b;
                        downloaded ++;
                        // log.info(`downloaded ${downloaded}/${res.length}`)
                        dlgDownload.updateCell(i, 0, b.type)
                        dlgDownload.updateCell(i, 2, r.saveas)
                        dlgDownload.updateCell(i, 3, "<font style='color:#cc5500'>buffered</font>")
                        if(downloaded == res.length){
                            end();
                        }
                    });
                });
            }else{
                end();
            }
        });
    };
    /* message listener */
    function getAllCssLoaded(){
        var css=[]
        for(let sheet of document.styleSheets){
            try{
                for (let rule of sheet.cssRules){
                    css.push(rule.cssText+"");
                }
            }catch(e){}
        }
        return css.join("\n");
    }
    function getImages(){
        var images=[]
        for(let image of document.images){
            images.push(image.src);
        }
        return images.join("\n");
    }
    browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        log.debug("content script recv msg:", request.type)
        if(request.type == "SAVE_PAGE" || request.type == "SAVE_PAGE_SELECTION"){
            return new Promise((resolve, reject) => {
                if(lock()){
                    dlgDownload = new DialogTable('Download', 'Waiting...', function(r){
                        unlock()
                        dlgDownload.remove()
                    });
                    dlgDownload.hideButton()
                    dlgDownload.addHeader("type", "source", "destination", "status")
                    dlgDownload.show()                
                    dlgDownload.hint = "Gethering resources...";
                    getContent(request.type == "SAVE_PAGE_SELECTION").then((data)=>{
                        dlgDownload.hint = "Saving data...";
                        saveData(data, request.rdf_path, request.scrapId).then(()=>{
                            dlgDownload.showButton()
                            dlgDownload.hint = "All done";
                            resolve();
                        });
                    });
                }else{
                    reject(Error("a task already exists on this page"))
                }
            });
        }
        return false;
    });
    function saveData(data, rdf_path, scrapId){
        log.debug("save data ...")
        var saved_blobs = 0;
        var {itemId, title, html, css, res} = data;
        // log.info(itemId, title, html, css, res)
        function savePage(resolve, reject){
            if((saved_blobs) == res.length){
                html = ['<!Doctype html>', html,].join("\n");
                var path = `${rdf_path}/data/${scrapId}/index.css`;
                browser.runtime.sendMessage({type: 'SAVE_TEXT_FILE', text: css, path}).then((response) => {
                    dlgDownload.updateCell(res.length, 3, "<font style='color:#0055ff'>saved</font>")
                    var path = `${rdf_path}/data/${scrapId}/index.html`;
                    browser.runtime.sendMessage({type: 'SAVE_TEXT_FILE', text: html, path}).then((response) => {
                        dlgDownload.updateCell(res.length+1, 3, "<font style='color:#0055ff'>saved</font>")
                        log.debug("capture, all done")
                        resolve();
                    });
                });
            }
        }    
        return new Promise((resolve, reject) => {
            if(res.length){
                res.forEach(function(item, i){
                    if(item.blob){
                        try{
                            var reg = new RegExp(item.hex, "g" )
                            if(item.hex)html = html.replace(reg, item.saveas);
                            item.path = `${rdf_path}/data/${scrapId}/${item.saveas}`;
                            browser.runtime.sendMessage({type: 'SAVE_BLOB_ITEM', item: item}).then((response) => {
                                dlgDownload.updateCell(i, 3, "<font style='color:#0055ff'>saved</font>")
                                saved_blobs++;
                                savePage(resolve, reject);
                            });
                        }catch(e){
                            log.error(e.message)
                        }
                    }else{ // not valid blob
                        saved_blobs++;
                        savePage(resolve, reject);
                    }
                });
            }else{ // no res
                savePage(resolve, reject);
            }
        });
    }
    function isDescendant(parent, child) {
        var node = child;
        while (node != null) {
            if (node == parent) {
                return true;
            }
            node = node.parentNode;
        }
        return false;
    }
    function downloadFile(url, callback){
        try{
            var oReq = new XMLHttpRequest();
            oReq.open("GET", url, true);
            oReq.responseType = "blob";
            oReq.onload = function(oEvent) {
                if(oReq.response){
                    callback(oReq.response);
                }else{
                    callback(false);
                }
            };
            oReq.onerror=function(e){
                callback(false);
            }
            oReq.send();
        }catch(e){
            log.error(`download file error, ${e}`)
            callback(false);
        }
    }
    function loadCss(id, href){
        $(`*[id='${id}']`).remove();
        var head  = document.getElementsByTagName('head')[0];
        var link  = document.createElement('link');
        link.id = id;
        link.rel  = 'stylesheet';
        link.type = 'text/css';
        link.href = href;
        link.media = 'all';
        head.appendChild(link);
    }
    var extension_id = browser.i18n.getMessage("@@extension_id");
    loadCss("content_script", `moz-extension://${extension_id}/content_script.css`)
    loadCss("content_script", `moz-extension://${extension_id}/dialog.css`)
}
console.log("[content_script.js] loaded")
