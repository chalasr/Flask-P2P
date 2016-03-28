(function (app) {
    app.run(function($rootScope, $filter) {
        $rootScope.messages = [];

        getTime = function(){
            return $filter('date')(new Date(), 'HH:mm:ss');
        };

        (function(strings, regex) {
            //Parse string
            strings.f = function () {
                var args = arguments;
                return this.replace(regex, function(token) {
                    var index = parseInt(token.substring(1, token.length ));
                    if (index >= 0 && args[index]) {
                        return args[index];
                    } else if (token === '%%') {
                        return '%';
                    }
                    return "";
                });
            };
            // Bold a string
            strings.bold = function() {
                return "<strong>%0</strong>".f(this);
            };
             // Converts into a unique number based on the sum of the char code values of each char.
            strings.toID = function() {
                var id = 0;
                for (var x = 0; x < this.length; x++)
                    id += this.charCodeAt(x);
                return id;
            };
            // Sanitize to avoid XSS
            strings.sanitize = function() {
                return this.replace(/[<\>''\/]/g, function(c) {
                    var sanitize_replace = {
                        '<' : '&lt;',
                        '>' : '&gt;',
                        "'" : '&quot;',
                        "'" : '&#x27;',
                        '/' : '&#x2F;'
                    };
                    return sanitize_replace[c];
                });
            };
        })(String.prototype, /%(\d+)|%%/g);
    });

})(angular.module('app', ['MainCtrl', 'RoomService'], function($interpolateProvider) {
    $interpolateProvider.startSymbol('<%');
    $interpolateProvider.endSymbol('%>');
}));
